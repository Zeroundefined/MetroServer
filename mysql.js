const mysql = require("mysql");

const connection = mysql.createConnection({
  host: '10.35.150.23',
  user: 'u_mo_tr',
  password: 'ideal@123',
  // host: '45.63.50.215',
  // user: 'root',
  // password: 'Password_01',
  database: 'db_mt',
  post: 3306
});


// const connection = mysql.createConnection({
//   host: '127.0.0.1',
//   user: 'root',
//   password: '12345678',
//   database: 'myTest',
//   post: 3306
// });
connection.connect();

module.exports = {
  connection
}
