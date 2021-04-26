import { Builder, By, IWebDriverCookie, Key, until, WebDriver } from "selenium-webdriver";
import { ServiceBuilder, Options } from "selenium-webdriver/chrome";
import { writeFile } from "fs";
import axios from "axios";

const fk: (err: Error) => void = (err) => {
	throw err;
}

const screen = {
	width: 1920,
	height: 1080
};

const get_driver: (sk: (driver: WebDriver) => void) => void = (sk) => {
	// TODO, fix this nasty path
	const chrome_service = new ServiceBuilder("/tmp/chromedriver_linux64/chromedriver")
	new Builder()
		.forBrowser("chrome")
		.setChromeService(chrome_service)
		.setChromeOptions(new Options().headless().windowSize(screen))
		.build()
		.then(driver => sk(driver))
		.catch(fk)
}


const load_login_page: (driver: WebDriver, sk: () => void) => void = (driver, sk) => {
	console.log("Loading login page");
	driver.get("https://accounts.zoho.com/signin?servicename=zohopeople&signupurl=https://www.zoho.com/people/signup.html")
	driver
		.wait(() =>
			driver.executeScript('return document.readyState')
				.then((readyState) => readyState === 'complete')
		)
		.then(() => {
			console.log("Login page loaded");
			sk()
		})
}

const log_action: (log: string, k: () => void) => void = (log, k) => {
	console.log(log)
	k();
}

const submit_creds: (driver: WebDriver, sk: () => void) => void = (driver, sk) => {
	const enter_email = (sk: () => void) =>
		log_action(`Entering Email ${process.env.ZOHO_EMAIL}`, () => driver.findElement(By.id("login_id")).sendKeys(process.env.ZOHO_EMAIL).then(sk).catch(fk));
	const submit_email = (sk: () => void) =>
		log_action("Submitting Email", () => driver.findElement(By.id("login_id")).sendKeys(Key.ENTER).then(sk).catch(fk));
	const enter_password = (sk: () => void) =>
		log_action("Entering Password", () => driver.findElement(By.id("password")).sendKeys(process.env.ZOHO_PASSWORD).then(sk).catch(fk));
	const submit_password = (sk: () => void) =>
		log_action("Submitting Password", () => driver.findElement(By.id("password")).sendKeys(Key.ENTER).then(sk).catch(fk));

	enter_email(() =>
		submit_email(() =>
			// hack until i figure this out, wait 3 seconds for the network request to finish.
			setTimeout(() =>
				enter_password(() =>
					submit_password(() =>
						setTimeout(() =>
							// TODO: find a way to confirm the login
							take_screenshot(driver, sk)
							, 3000)
					)
				)
				, 3000)
		)
	)
}

const print_html: (driver: WebDriver, sk: () => void) => void = (driver, sk) => {
	driver.getPageSource().then((src) => {
		console.log(src);
		sk();
	});
}

const take_screenshot: (driver: WebDriver, sk: () => void) => void = (driver, sk) => {
	driver
		.takeScreenshot()
		.then(image =>
			writeFile("./data/screenshot.png", image, { encoding: "base64" }, sk)
		)
}

type auth_cookies = {
	_iamadt: string,
	_iambdt: string,
	CSRF_TOKEN: string,
}


const get_cookie: (driver: WebDriver, key: string, sk: (value: IWebDriverCookie) => void) => void = (driver, key, sk) =>
	driver
		.manage()
		.getCookie(key)
		.then(x =>
			x === null
				? console.log(`Cannot find cookie ${key} ... Aborting`)
				: sk(x)
		)

const get_auth_cookies: (driver: WebDriver, sk: (auth: auth_cookies) => void) => void = (driver, sk) =>
	get_cookie(driver, "_iamadt", ({ value: _iamadt }) =>
		get_cookie(driver, "_iambdt", ({ value: _iambdt }) =>
			get_cookie(driver, "CSRF_TOKEN", ({ value: CSRF_TOKEN }) => {
				console.log({ auth: { CSRF_TOKEN, _iamadt, _iambdt } })
				sk({ CSRF_TOKEN, _iamadt, _iambdt })
			})
		)
	)


const make_cookie: (obj: {[x: string]: string}) => string = (obj) => 
	Object.entries(obj).map(([k, v]) => `${k}=${v}`).join(";")


const form_data_uri_econded: (data: { [x: string]: string }) => string = (data) =>
	Object.keys(data).map(k => `${k}=${encodeURIComponent(data[k])}`).join("&");

const load_month_attendance_sheet: (auth: auth_cookies, month_offset: number, sk: () => void) => void = (auth, month_offset) => {
	axios({
		url: "https://people.zoho.com/hrportal1524046672626/AttendanceViewAction.zp",
		method: "POST",
		headers: {
			Cookie: make_cookie(auth),
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
		},
		data: form_data_uri_econded({
			mode: "getAttList",
			loadToday: "false",
			view: "month", 
			preMonth: "0", // how many months shift in the past
			conreqcsr: auth.CSRF_TOKEN
		})
	}).then((res) => {
		console.log(JSON.stringify(res.data, undefined, 2))
	}).catch(err => {
		console.log(err)
	})
}

get_driver(driver => {
	load_login_page(driver, () =>
		submit_creds(driver, () => {
			take_screenshot(driver, () => {
				get_auth_cookies(driver, auth => {
					load_month_attendance_sheet(auth, 0, () => {

					})
				})
			})
		})
	)
})