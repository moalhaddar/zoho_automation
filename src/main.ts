import axios from 'axios';
import { createInterface } from 'readline';
import { access, readFile, writeFile } from 'fs';
import { createTransport } from 'nodemailer';


/**
 * Scope: ZOHOPEOPLE.attendance.ALL
 */

// TODO: cleanup this global to its own constructor function
const readline = createInterface({
  input: process.stdin
});

const die: (err: Error) => void = (err) => {
  // TODO: proper error handling
  throw err;
};

const form_data_uri_econded: (data: { [x: string]: string }) => string = (data) =>
  Object.keys(data).map(k => `${k}=${encodeURIComponent(data[k])}`).join('&');

//TODO: export to env variable
const with_client_id: (sk: (client_id: string) => void) => void = (sk) =>
  readline.question('Client ID: ', (client_id) => sk(client_id));

//TODO: export to env variable
const with_client_secret: (sk: (client_secret: string) => void) => void = (sk) =>
  readline.question('Client Secret: ', (client_secret) => sk(client_secret));

//TODO: export to env variable
const with_self_generated_code: (sk: (self_generated_code: string) => void) => void = (sk) =>
  readline.question('Self generated code: ', (self_generated_code) => sk(self_generated_code));


const is_credentials_file_exist: (sk: (is_exist: boolean) => void) => void = (sk) =>
  access('./data/creds.json', (err) => sk(!err));


const load_credentials_data: (sk: (credentials: { refresh_token: string, client_id: string, client_secret: string }) => void) => void = (sk) =>
  readFile('./data/creds.json', (err, data) =>
    err
      ? die(err)
      : sk(JSON.parse(data.toString()))
  );

const write_credentials_data: (data: { refresh_token: string, client_id: string, client_secret: string }, sk: () => void) => void = (data, sk) =>
  writeFile('./data/creds.json', JSON.stringify(data), sk);

const create_credentials_data: (sk: (creds: { access_token: string, client_id: string, client_secret: string }) => void) => void = (sk) =>
  with_client_id(client_id =>
    with_client_secret(client_secret =>
      with_self_generated_code(code =>
        grant_refresh_token({ client_id, client_secret, code }, (refresh_token) =>
          write_credentials_data({ client_id, client_secret, refresh_token }, () =>
            grant_access_token({ client_id, client_secret, refresh_token }, access_token =>
              sk({ access_token, client_id, client_secret })
            )
          )
        )
      )
    )
  );

const is_in_working_days: (day_index: number) => boolean = (day_index) => {
  const working_days = ['sat', 'sun', 'mon', 'tues', 'wed', 'thurs'];
  const day_index_to_day_map = {
    0: 'sun',
    1: 'mon',
    2: 'tues',
    3: 'wed',
    4: 'thurs',
    5: 'fri',
    6: 'sat'
  };

  return working_days.includes(day_index_to_day_map[day_index]);
};

const date_to_dd_MM_yyyy: (date: Date) => string = (date) => {
  const month = '' + (date.getMonth() + 1);
  const day = '' + date.getDate();
  const year = date.getFullYear();
  return [day.length < 2 ? `0${day}` : day, month.length < 2 ? `0${month}` : month, year].join('-');
};

const get_workdays_in_current_month: () => string[] = () => {
  // Get all valid past dates in week range [Sat, thurs] in current month
  const current_year = new Date().getUTCFullYear(); // e.g. 2021
  const current_month = new Date().getMonth(); // e.g. April
  const current_day = new Date().getDate(); // e.g. 23rd
  return Array.from({ length: current_day }, (_, i) => i+1)
    .map(day => new Date(current_year, current_month, day))
    .filter(date => is_in_working_days(date.getDay()))
  // At this point i've figured i should've went with a date library .. but then i wont have fun writing date manipulation functions :)
    .map(date => date_to_dd_MM_yyyy(date));
};

// recursion time because Promise.all is boring
const get_attendance_entries: (access_token: string, workdays: string[], k: (entries: attendance_entry[]) => void) => void = (access_token, workdays, k) => {
  if (workdays.length === 0) {
    k([]);
  } else {
    const [date, ...rest] = workdays;
    get_attendance_entry({access_token, date}, (entry) => 
      get_attendance_entries(access_token, rest, (entries) => k([entry, ...entries]))
    );
  }
};

// const notify_me_about_missing_check_ins: (entries: attendance_entry[]) => void = (entries) => {
// 	// If only zoho people provided an api endpoint for reguralization ...
// 	const trasnporter = createTransport({
// 		host: process.env.mailer_host, // smtp.gmail.com
// 		port: 587,
// 		secure: false,
// 		auth: {
// 			user: process.env.mailer_user,
// 			pass: process.env.mailer_password
// 		}
// 	})

// 	trasnporter.sendMail({
// 		from: "Zoho Notifier <test@zoho_automation.com>",
// 		to: process.env.reciever_email,
// 		subject: "Missing Zoho check-ins",
// 		text: `
// 			The following days are missing check-ins in zoho.
// TODO missing the work date here
// 			${entries.map(x => `${x.}`)}
// 		`
// 	})
	
// }

const start_workflow: (creds: { access_token: string, client_id: string, client_secret: string }) => void = ({ access_token, client_id, client_secret }) => {
  // Their stupid API requires dd-MM-yyyy format even if you ask it for another format ...
  const workdays = get_workdays_in_current_month();

  get_attendance_entries(access_token, workdays, (entries) => {
    console.log(entries);
    // notify_me_about_missing_check_ins(entries.filter(x => x.totalHrs === "00:00"))
  });

  //TODO: this is wrong
  readline.close();
};

type attendance_entry = {
	firstIn: string,
	totalHrs: string, // HH:mm
	entires: Array<unknown>,
	lastOut_Location: string,
	lastOut: string,
	firstIn_Location: string,
	status: string,
}

const get_attendance_entry: (args: {access_token: string, date: string},  sk:(entries: attendance_entry) => void) => void = ({date, access_token}, sk) =>
  axios({
    url: 'https://people.zoho.com/people/api/attendance/getAttendanceEntries',
    method: 'POST',
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Zoho-oauthtoken ${access_token}`
    },
    data: form_data_uri_econded({
      date,
      dateFormat: 'yyyy-MM-dd'
    })
  })
    .then(({data}) => sk((data)))
    .catch(die);

const grant_access_token: (creds: { refresh_token: string, client_id: string, client_secret: string }, sk: (access_token: string) => void) => void = ({ client_id, client_secret, refresh_token }, sk) =>
  axios({
    url: 'https://accounts.zoho.com/oauth/v2/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form_data_uri_econded({
      grant_type: 'refresh_token',
      client_id,
      client_secret,
      refresh_token,
      redirect_uri: ''
    })
  })
  // TODO: type me
    .then(({data}) => {
      if (data.error) {
        die(data.error);
      } else {
        sk(data.access_token);
      }
    })
    .catch(die);

const grant_refresh_token: (creds: { client_id: string, client_secret: string, code: string }, sk: (refresh_token: string) => void) => void = ({ client_id, client_secret, code }, sk) =>
  axios({
    url: 'https://accounts.zoho.com/oauth/v2/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form_data_uri_econded({
      grant_type: 'authorization_code',
      client_id,
      client_secret,
      code,
      redirect_uri: ''
    })
  })
  // TODO: type me
    .then(({ data }) => {
      if (data.error) {
        die(data.error);
      } else {
        sk(data.refresh_token);
      }
    })
    .catch(die);

const start: () => void = () => 
  is_credentials_file_exist(is_exist =>
    is_exist
      ? load_credentials_data(({ client_id, client_secret, refresh_token }) =>
        grant_access_token({ refresh_token, client_id, client_secret }, access_token =>
          start_workflow({ access_token, client_id, client_secret })
        )
      )
      : create_credentials_data(({access_token, client_id, client_secret}) => 
        start_workflow({access_token, client_id , client_secret})
      )
  );

start();
