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
  if (!checkAuth(req, res)) {
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

app.get('/getOriginTables', (req, res) => {
  if (!checkAuth(req, res)) {
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
        errMsg: "获取元数据表出错"
      })
    } else {
      res.status(200).json({
        data: lodash.filter(data, o => o.Tables_in_db_mt.indexOf('origin') > -1).map(item => item.Tables_in_db_mt),
        errMsg: null
      })
    }
  })
})

app.get('/getData', (req, res) => {
  if (!checkAuth(req, res)) {
    res.status(200).json({
      data: null,
      code: 401,
      errMsg: "登录过期"
    })

    return
  }
  const { table, timeRange, keyword, field } = req.query;
  const range = timeRange.split(',');
  mysql.connection.query(`select * from ${req.query.table} where (datelabel between '${range[0]}' and '${range[1]}') and ${field} like '%${keyword || ''}%'`, (err, data) => {
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
  // if(!checkAuth(req, res)) {
  //   res.status(200).json({
  //     data: null,
  //     code: 401,
  //     errMsg: "登录过期"
  //   })

  //   return
  // }
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
  /** 计划施工总量 */
  let workingTotal = 0;

  const p1 = new Promise((resolve, reject) => {
    mysql.connection.query(`select type, staut, sum(number) ratio
    from material_information_result where (datelabel between '${range[0]}' and '${range[1]}') group by type, staut order by type;`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "物资信息计算出错"
          })
        } else {
          final.material = lodash.groupBy(data, 'type');
          resolve();
        }
      })
  })

  const p2 = new Promise((resolve, reject) => {
    mysql.connection.query(`select hour, sum(num) count
    from polling_num_hour_result where line = 'all' and (datelabel between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
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

  const p3 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(num) count
    from polling_num_result where (datelabel between '${range[0]}' and '${range[1]}') and line = 'all'`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "巡检信息计算出错"
          })
        } else {
          final.polling.count = data[0].count;
          resolve();
        }
      })
  })

  const p4 = new Promise((resolve, reject) => {
    mysql.connection.query(`select ROUND(sum(avg_duration) / ${length},2) duration
    from polling_avg_duration_result where (datelabel between '${range[0]}' and '${range[1]}') and line = 'all'`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "巡检信息计算出错"
          })
        } else {
          final.polling.duration = data[0].duration;
          resolve();
        }
      })
  })

  const p5 = new Promise((resolve, reject) => {
    mysql.connection.query(`select type, sum(number) ratio
    from construction_cashing_rate_result where (datelabel between '${range[0]}' and '${range[1]}') group by type;`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          workingTotal = lodash.find(data, {type: '计划完成施工'});
          const workingActual = lodash.find(data, {type: '实际完成施工'});
          final.working.reachRatio = workingActual / workingTotal;
          resolve();
        }
      })
  })

  const p6 = new Promise((resolve, reject) => {
    mysql.connection.query(`select ROUND(sum(ratio) / ${length},2) ratio
    from construction_utilization_ratio_result where (datelabel between '${range[0]}' and '${range[1]}')`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.hourRatio = data[0].ratio;
          resolve();
        }
      })
  })

  const p7 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(number) count
    from construction_change_rate_result where (datelabel between '${range[0]}' and '${range[1]}')`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.updateRatio = data[0].count / workingTotal;
          resolve();
        }
      })
  })

  const p8 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(number) count
    from construction_Irregularities_result where (datelabel between '${range[0]}' and '${range[1]}')`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.illegal = data[0].count;
          resolve();
        }
      })
  })

  const p9 = new Promise((resolve, reject) => {
    mysql.connection.query(`select line, sum(number) count
    from construction_line_result where (datelabel between '${range[0]}' and '${range[1]}') group by line`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.lineDivided = data;
          resolve();
        }
      })
  })

  const p10 = new Promise((resolve, reject) => {
    mysql.connection.query(`select hour, sum(number) count
    from construction_line_result where hour != 'all' and (datelabel between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "施工信息计算出错"
          })
        } else {
          final.working.hourDivided = data;
          resolve();
        }
      })
  })

  const p11 = new Promise((resolve, reject) => {
    mysql.connection.query(`select first_type, sum(number) count
    from facility_class_sum_result where secd_type='level_01' and first_type!='all' and (datelabel between '${range[0]}' and '${range[1]}') group by first_type`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "设备信息计算出错"
          })
        } else {
          final.equip.firstTypeCount = data;
          resolve();
        }
      })
  })

  const p12 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(number) count
    from facility_class_sum_result where first_type='all' and (datelabel between '${range[0]}' and '${range[1]}')`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "设备信息计算出错"
          })
        } else {
          final.equip.equipTotal = data[0].count;
          resolve();
        }
      })
  })

  const p13 = new Promise((resolve, reject) => {
    mysql.connection.query(`select first_type, secd_type, sum(number) count
    from facility_class_sum_result where secd_type!='level_01' and first_type!='all' and (datelabel between '${range[0]}' and '${range[1]}') group by first_type,secd_type`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "设备信息计算出错"
          })
        } else {
          final.equip.secdTypeTotal = lodash.groupBy(data, 'first_type');
          resolve();
        }
      })
  })

  const p14 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(num) count
    from breakdown_facility_01_result where (datelabel between '${range[0]}' and '${range[1]}');`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.delayCount = data[0].count;
          resolve();
        }
      })
  })

  const p15 = new Promise((resolve, reject) => {
    mysql.connection.query(`select sum(num) count
    from breakdown_facility_02_result where (datelabel between '${range[0]}' and '${range[1]}');`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.lostCount = data[0].count;
          resolve();
        }
      })
  })

  const p16 = new Promise((resolve, reject) => {
    mysql.connection.query(`select type, sum(num) count
    from breakdown_type_ratio_result where (datelabel between '${range[0]}' and '${range[1]}') group by type`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.faultType = data;
          resolve();
        }
      })
  })

  const p17 = new Promise((resolve, reject) => {
    mysql.connection.query(`select status, sum(num) count
    from breakdown_statu_result where (datelabel between '${range[0]}' and '${range[1]}') group by status`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.faultHandle = data;
          resolve();
        }
      })
  })

  const p18 = new Promise((resolve, reject) => {
    mysql.connection.query(`select hour, sum(num) count
    from breakdown_24h_sum_result where (datelabel between '${range[0]}' and '${range[1]}') group by hour`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.hourDivided = data;
          resolve();
        }
      })
  })

  const p19 = new Promise((resolve, reject) => {
    mysql.connection.query(`select line, sum(num) count
    from breakdown_line_sum_result where (datelabel between '${range[0]}' and '${range[1]}') group by line`, (err, data) => {
        if (err) {
          reject();
          res.status(200).json({
            data: null,
            errMsg: "故障信息计算出错"
          })
        } else {
          final.fault.lineDivided = data;
          resolve();
        }
      })
  })

  Promise.all([p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19]).then(() => {
    res.status(200).json({
      data: final,
      errMsg: null
    })
  })
})

app.post('/updateData', (req, res) => {
  if (!checkAuth(req, res)) {
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
  if (!checkAuth(req, res)) {
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
  if (!checkAuth(req, res)) {
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