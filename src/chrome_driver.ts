import { Builder, By, IWebDriverCookie, Key, WebDriver } from 'selenium-webdriver';
import { ServiceBuilder, Options } from 'selenium-webdriver/chrome';
import { writeFile } from 'fs';
import axios from 'axios';

type fk_function = (err: Error) => void;

const screen = {
  width: 1920,
  height: 1080
};

const get_driver: (fk: fk_function, sk: (driver: WebDriver) => void) => void = (fk, sk) => {
  // TODO, fix this nasty path
  const chrome_service = new ServiceBuilder('/tmp/chromedriver_linux64/chromedriver');
  new Builder()
    .forBrowser('chrome')
    .setChromeService(chrome_service)
    .setChromeOptions(new Options().headless().windowSize(screen))
    .build()
    .then(driver => sk(driver))
    .catch(fk);
};


const load_login_page: (driver: WebDriver, fk: fk_function, sk: () => void) => void = (driver, fk, sk) => {
  console.log('Loading login page');
  driver.get('https://accounts.zoho.com/signin?servicename=zohopeople&signupurl=https://www.zoho.com/people/signup.html');
  driver
    .wait(() =>
      driver.executeScript('return document.readyState')
        .then((readyState) => readyState === 'complete')
    )
    .then(() => {
      console.log('Login page loaded');
      sk();
    });
};

const log_action: (log: string, k: () => void) => void = (log, k) => {
  console.log(log);
  k();
};

const submit_creds: (driver: WebDriver, fk: fk_function, sk: () => void) => void = (driver, fk, sk) => {
  const enter_email = (sk: () => void) =>
    log_action(`Entering Email ${process.env.ZOHO_EMAIL}`, () => driver.findElement(By.id('login_id')).sendKeys(process.env.ZOHO_EMAIL).then(sk).catch(fk));
  const submit_email = (sk: () => void) =>
    log_action('Submitting Email', () => driver.findElement(By.id('login_id')).sendKeys(Key.ENTER).then(sk).catch(fk));
  const enter_password = (sk: () => void) =>
    log_action('Entering Password', () => driver.findElement(By.id('password')).sendKeys(process.env.ZOHO_PASSWORD).then(sk).catch(fk));
  const submit_password = (sk: () => void) =>
    log_action('Submitting Password', () => driver.findElement(By.id('password')).sendKeys(Key.ENTER).then(sk).catch(fk));

  enter_email(() =>
    submit_email(() =>
    // hack until i figure this out, wait 3 seconds for the network request to finish.
      setTimeout(() =>
        enter_password(() =>
          submit_password(() =>
            setTimeout(() =>
            // TODO: find a way to confirm the login
              take_screenshot(driver, fk, sk)
            , 3000)
          )
        )
      , 3000)
    )
  );
};

// const print_html: (driver: WebDriver, sk: () => void) => void = (driver, sk) => {
//   driver.getPageSource().then((src) => {
//     console.log(src);
//     sk();
//   });
// };

const take_screenshot: (driver: WebDriver, fk: fk_function, sk: () => void) => void = (driver, fk, sk) => {
  driver
    .takeScreenshot()
    .then(image =>
      writeFile('./data/screenshot.png', image, { encoding: 'base64' }, sk)
    ).catch(fk);
};

type auth_cookies = {
	_iamadt: string,
	_iambdt: string,
	CSRF_TOKEN: string,
}


const get_cookie: (driver: WebDriver, key: string, fk: fk_function, sk: (value: IWebDriverCookie) => void) => void = (driver, key, fk, sk) =>
  driver
    .manage()
    .getCookie(key)
    .then(sk)
    .catch(() => fk(new Error(`Cannot find cookie ${key}`)));

const get_auth_cookies: (driver: WebDriver, fk: fk_function, sk: (auth: auth_cookies) => void) => void = (driver, fk, sk) =>
  get_cookie(driver, '_iamadt', fk, ({ value: _iamadt }) =>
    get_cookie(driver, '_iambdt', fk, ({ value: _iambdt }) =>
      get_cookie(driver, 'CSRF_TOKEN', fk, ({ value: CSRF_TOKEN }) => {
        console.log({ auth: { CSRF_TOKEN, _iamadt, _iambdt } });
        sk({ CSRF_TOKEN, _iamadt, _iambdt });
      })
    )
  );


const make_cookie: (obj: {[x: string]: string}) => string = (obj) =>
  Object.entries(obj).map(([k, v]) => `${k}=${v}`).join(';');


const form_data_uri_econded: (data: { [x: string]: string }) => string = (data) =>
  Object.keys(data).map(k => `${k}=${encodeURIComponent(data[k])}`).join('&');


type day = {
  status: 'Present' | 'Absent' | 'Weekend' | ''
  tHrs: string // HH:mm format
  orgdate: string /// yyyy-MM-dd
}

type attendance_sheet = {
  dayList: {
    [x: string]: day
  }
}

const load_month_attendance_sheet: (auth: auth_cookies, month_offset: number, fk: fk_function, sk: (sheet: attendance_sheet) => void) => void = (auth, month_offset, fk, sk) => {
  axios({
    url: 'https://people.zoho.com/hrportal1524046672626/AttendanceViewAction.zp',
    method: 'POST',
    headers: {
      Cookie: make_cookie(auth),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    data: form_data_uri_econded({
      mode: 'getAttList',
      loadToday: 'false',
      view: 'month',
      preMonth: month_offset.toString(), // how many months shift in the past
      conreqcsr: auth.CSRF_TOKEN
    })
  }).then((res) => {
    sk(res.data);
  }).catch(err => {
    console.log(err);
  });
};

const day_of: (date: Date) => number = (date) => date.getDate();

const get_days_that_needs_regularization: (sheet: attendance_sheet, fk:fk_function, sk: (days: string[]) => void) => void = (sheet, fk, sk) => {
  const today = new Date();
  sk(
    Object
      .values(sheet.dayList)
      .filter(
        (day) =>
          day.tHrs === '00:00' &&
          day.status !== 'Weekend' &&
        (day_of(new Date(day.orgdate)) < day_of(today) )
      )
      .map(day => day.orgdate)
  );
};


const regularize_day: (auth: auth_cookies, date: string, fk: fk_function, sk: (day: string) => void) => void = (auth, date, fk, sk) => {
  axios({
    url: 'https://people.zoho.com/hrportal1524046672626/AttendanceAction.zp',
    method: 'POST',
    headers: {
      Cookie: make_cookie(auth),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    data: form_data_uri_econded({
      mode: 'bulkAttendReg',
      erecno: '411351000004206045', // Is this magic string good here?
      fdate: date,
      isFromEntryPage: 'false',
      dateObj: JSON.stringify({
        date: {
          ftime: 0,
          ttime: 0,
        }
      }),
      conreqcsr: auth.CSRF_TOKEN
    })
  }).then((res) => {
    sk(res.data);
  }).catch(err => {
    console.log(err);
  });
};

const date_to_dd_MM_yyyy: (date: Date) => string = (date) => {
  const month = '' + (date.getMonth() + 1);
  const day = '' + date.getDate();
  const year = date.getFullYear();
  return [day.length < 2 ? `0${day}` : day, month.length < 2 ? `0${month}` : month, year].join('-');
};

const regularize_many_days: (auth: auth_cookies, days: string[], fk: fk_function, sk: () => void) => void = (auth, days, fk, sk) => {
  const days_in_fixed_format = days.map(x => date_to_dd_MM_yyyy(new Date(x)));
  console.log(`Regularizing ${days_in_fixed_format}`);
  Promise.all(days_in_fixed_format.map(day => regularize_day(auth, day, fk, (day) => console.log(`Successfully regularized ${day}`))))
    .then(sk)
    .catch(fk);
};

const start_loop: () => void = () => {
  // whenever a step fails, go back to square one and retry after 12 hours
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  const retry = () => {
    console.log(`Retrying again at ${new Date(new Date().getTime() + TWELVE_HOURS).toISOString()}`);
    setTimeout(start_loop, TWELVE_HOURS);
  };

  const fk = (err: Error) => {
    console.log(`Failed at ${new Date().toISOString()}`);
    console.log(JSON.stringify(err));
    retry();
  };

  const sk = () => {
    console.log(`Loop completed at ${new Date().toISOString()}`);
    retry();
  };

  get_driver(fk, driver =>
    load_login_page(driver, fk, () =>
      submit_creds(driver, fk,  () =>
        take_screenshot(driver, fk, () =>
          get_auth_cookies(driver, fk,  auth =>
            load_month_attendance_sheet(auth, 0, fk, (sheet) =>
              get_days_that_needs_regularization(sheet, fk, need_regz =>
                regularize_many_days(auth, need_regz, fk, sk)
              )
            )
          )
        )
      )
    )
  );
};


start_loop();