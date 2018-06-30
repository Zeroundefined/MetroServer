const express = require('express');
const bodyParser = require('body-parser');
const lodash = require('lodash');
const mysql = require('./mysql');
const puppeteer = require('puppeteer');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const ejs = require('ejs');

const app = express();

app.use(cookieParser());
app.engine('html', ejs.__express);
app.set('view engine', 'html');
app.use('/static', express.static('public'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.post('/login', function (req, res) {
  const { userName, password } = req.body;
  mysql.connection.query("select userName, password from user", (err, data) => {
    if (err) {
      res.status(200).json({
        data: null,
        errMsg: "获取用户数据出错"
      })
    } else {
      const target = lodash.find(data, { userName, password });
      if (target) {
        const token = new Date().getTime();
        res.cookie('token', token);
        mysql.connection.query(`update user set token = ${token} where userName = '${target.userName}'`, (err, data) => {
          if (err) {
            res.status(200).json({
              data: null,
              errMsg: "获取用户数据出错"
            })
          } else {
            res.status(200).json({
              data: { userName },
              errMsg: null
            })
          }
        })
      } else {
        res.status(200).json({
          data: null,
          errMsg: "用户名，密码输入有误，请重新输入"
        })
      }
    }
  })
});

app.get('/getResultTables', (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  mysql.connection.query("show tables", (err, data) => {
    if (err) {
      res.status(200).json({
        data: null,
        errMsg: "获取结果表出错"
      })
    } else {
      res.status(200).json({
        data: lodash.filter(data, o => o.Tables_in_db_mt.indexOf('result') > -1).map(item => item.Tables_in_db_mt),
        errMsg: null
      })
    }
  })
})

app.get('/getData', (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  const { table, timeRange, keyword, field } = req.query;
  const range = timeRange.split(',');
  mysql.connection.query(`select * from ${req.query.table} where (date between '${range[0]}' and '${range[1]}') and ${field} like '%${keyword || ''}%'`, (err, data) => {
    if (err) {
      res.status(200).json({
        data: null,
        errMsg: "获取数据出错"
      })
    } else {
      res.status(200).json({
        data,
        errMsg: null
      })
    }
  })
})

app.get('/getCalcData', (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  const { timeRange } = req.query;
  const range = timeRange.split(',');
  const length = (new Date(range[1]) - new Date(range[0])) / 3600 / 24 / 1000;
  const final = {
    fault: {},
    working: {},
    equip: {},
    material: {},
    polling: {}
  };

  const p1 = new Promise((resolve, reject) => {
    mysql.connection.query(`select 
    sum(type_comm) type_comm, sum(type_net) type_net, sum(type_other) type_other, sum(type_signal) type_signal, 
    sum(state_closed) state_closed, sum(state_fixed) state_fixed, sum(state_new) state_new, sum(state_processed) state_processed 
    from breakdown_facility_result where (date between '${range[0]}' and '${range[1]}') and hour = '全天'`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          const info = Object.entries(data[0]);
          final.fault.faultType = info.slice(0, 4);
          final.fault.faultHandle = info.slice(4);
          resolve();
        }
      })
  })

  const p2 = new Promise((resolve, reject) => {
    mysql.connection.query(`select 
    hour, sum(line1) line1, sum(line2) line2, sum(line3) line3, sum(line4) line4, sum(line5) line5, sum(line6) line6, sum(line7) line7, sum(line8) line8, sum(line9) line9, sum(line10) line10, sum(line11) line11, sum(line12) line12, sum(line13) line13, sum(line14) line14, sum(line15) line15, sum(line16) line16, sum(line17) line17
    from breakdown_facility_result where (date between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
        if (err) {
          reject()
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.hourDivided = data.map(row => {
            const spittingInfo = Object.values(row);
            return {
              key: spittingInfo[0],
              value: lodash.reduce(spittingInfo.slice(1), (sum, n) => {
                return sum + n;
              }, 0)
            }
          });
          final.fault.lineDivided = lodash.find(data, { hour: '全天' });
          resolve();
        }
      })
  })

  const p3 = new Promise((resolve, reject) => {
    mysql.connection.query(`select 
    sum(construction_reach_ratio)/${length} reachRatio, sum(construction_hour_ratio)/${length} hourRatio, sum(construction_update_ratio)/${length} updateRatio, sum(construction_illegal) illegal, 
    sum(line1) line1, sum(line2) line2, sum(line3) line3, sum(line4) line4, sum(line5) line5, sum(line6) line6, sum(line7) line7, sum(line8) line8, sum(line9) line9, sum(line10) line10, sum(line11) line11, sum(line12) line12, sum(line13) line13, sum(line14) line14, sum(line15) line15, sum(line16) line16, sum(line17) line17
    from construction_information_result where (date between '${range[0]}' and '${range[1]}') and hour = '全天'`, (err, data) => {
        if (err) {
          reject()
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          const info = Object.entries(data[0]);
          final.working.reachRatio = info[0][1];
          final.working.hourRatio = info[1][1];
          final.working.updateRatio = info[2][1];
          final.working.illegal = info[3][1];
          final.working.lineDivided = info.slice(4);
          resolve();
        }
      })
  })

  const p4 = new Promise((resolve, reject) => {
    mysql.connection.query(`select hour, sum(construction_num) constructionNum
    from construction_information_result where (date between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.hourDivided = data.map(row => {
            const spittingInfo = Object.values(row);
            return {
              key: spittingInfo[0],
              value: spittingInfo[1]
            }
          })
          resolve();
        }
      })
  })

  const p5 = new Promise((resolve, reject) => {
    mysql.connection.query(`select first_class, third_class, ROUND(sum(third_class_ratio) / ${length},2) ratio
    from facility_information_result where third_class != 'all' and (date between '${range[0]}' and '${range[1]}') group by third_class, first_class;`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "设备信息计算出错"
          })
        } else {
          final.equip.thirdClass = lodash.groupBy(data, 'first_class');
          resolve();
        }
      })
  })

  const p6 = new Promise((resolve, reject) => {
    mysql.connection.query(`select first_class, ROUND(sum(third_class_ratio) / ${length},2) ratio
    from facility_information_result where third_class = 'all' and (date between '${range[0]}' and '${range[1]}') group by first_class;`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "设备信息计算出错"
          })
        } else {
          final.equip.firstClass = data.map(item => {
            const info = Object.values(item);
            return {
              key: info[0],
              value: info[1]
            }
          })
          resolve();
        }
      })
  })

  const p7 = new Promise((resolve, reject) => {
    mysql.connection.query(`select first_class, third_class, ROUND(sum(third_class_ratio) / ${length},2) ratio
    from material_information_result where third_class != 'all' and (date between '${range[0]}' and '${range[1]}') group by third_class, first_class;`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "物资信息计算出错"
          })
        } else {
          final.material.thirdClass = lodash.groupBy(data, 'first_class');
          resolve();
        }
      })
  })

  const p8 = new Promise((resolve, reject) => {
    mysql.connection.query(`select hour, ROUND(sum(duration) / ${length},2) duration
    from polling_information_result where (date between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "巡检信息计算出错"
          })
        } else {
          final.polling.hourDivided = data.map(item => {
            const info = Object.values(item);
            return {
              key: info[0],
              value: info[1]
            }
          })
          resolve();
        }
      })
  })

  const p9 = new Promise((resolve, reject) => {
    mysql.connection.query(`select ROUND(sum(frequent) / ${length},2) frequent
    from polling_information_result where (date between '${range[0]}' and '${range[1]}') and hour = '全天'`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "巡检信息计算出错"
          })
        } else {
          final.polling.frequent = data;
          resolve();
        }
      })
  })

  Promise.all([p1, p2, p3, p4, p5, p6, p7, p8, p9]).then(() => {
    res.status(200).json({
      data: final,
      errMsg: null
    })
  })
})

app.post('/updateData', (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  const { selectedTable, editingItem, value, editor } = req.body;
  mysql.connection.query(`update ${selectedTable} set ${editingItem.field} = ${value} where id=${editingItem.id}`, (err, data) => {
    if (err) {
      res.status(200).json({
        data: null,
        errMsg: "更新数据出错"
      })
    } else {
      mysql.connection.query(`insert into log (time, tableName, editer) values('${new Date().toLocaleString()}', '${selectedTable}', '${editor}')`, (err, value) => {
        if (err) {
          res.status(200).json({
            data: null,
            errMsg: "更新日志数据出错"
          })
        } else {
          res.status(200).json({
            data: true,
            errMsg: null
          })
        }
      })
    }
  })
})

app.get('/getLog', (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  mysql.connection.query(`select * from log`, (err, data) => {
    if (err) {
      res.status(200).json({
        data: null,
        errMsg: "获取日志出错"
      })
    } else {
      res.status(200).json({
        data: (data || []).map(item => {
          return {
            id: item.id,
            content: `${item.time} 用户${item.editer}编辑了${item.tableName.indexOf('result') > -1 ? '结果表' : '元数据表'}${item.tableName}`
          }
        }),
        errMsg: null
      })
    }
  })
})

app.post('/screenshot', async (req, res) => {
  if(!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  const { content } = req.body;
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.setViewport({
    width: 1200,
    height: 4400
  })
  await page.goto('http://www.baidu.com');
  await page.evaluate(`
      document.querySelectorAll('.highcharts-credits').forEach(item => item.style.display = 'none');
      document.body.innerHTML = \`${content}\`
    `);
  await page.screenshot({ path: 'report.png' });
  await browser.close();

  res.status(200).json({
    data: true,
    errMsg: null
  })
})

app.get('/download', (req, res) => {
  res.set({
    "Content-type": "application/octet-stream",
    "Content-Disposition": "attachment;filename=report.png"
  });
  const filestream = fs.createReadStream('./report.png');
  filestream.on('data', function (chunk) {
    res.write(chunk);
  });
  filestream.on('end', function () {
    res.end();
  });
})

app.get('/backdoor', (req, res) => {
  res.status(200).json({
    launched: true
  })
})

function checkAuth(req, res) {
  const now = new Date();
  const last = req.cookies.token;
  return now - last < 3600000;
}

app.get('*', (req, res) => {
  res.status(200).render('index.html');
})

app.listen(3000);