const _ = require('lodash');
const winston = require('winston');
const { DatabaseTransport } = require('./Transport');

class Driver {
  setConfig(config) {
    this.config = Object.assign({}, {
      tableName: 'app_logs',
      client: 'mysql',
      connection: {
        host: '127.0.0.1',
        port: '3306',
        user: 'root',
        password: '',
        database: 'adonis',
      },
      level: 'warning',
    }, config);

    const format = this.config.format || winston.format.combine(
      winston.format.colorize(),
      winston.format.splat(),
      winston.format.simple()
    );

    delete this.config.format;

    /**
     * Creating new instance of winston with file transport
     */
    winston.transports.DatabaseTransport = DatabaseTransport;
    this.logger = winston.createLogger({
      format,
      levels: this.levels,
      transports: [new winston.transports.DatabaseTransport(this.config)]
    });
  }

  get levels() {
    return {
      emerg: 0,
      alert: 1,
      crit: 2,
      error: 3,
      warning: 4,
      notice: 5,
      info: 6,
      debug: 7
    };
  }

  /**
   * Returns the current level for the driver
   *
   * @attribute level
   *
   * @return {String}
   */
  get level() {
    return this.logger.transports[0].level;
  }

  set level(level) {
    this.logger.transports[0].level = level;
  }


  log(level, msg, ...meta) {
    const levelName = _.findKey(this.levels, num => num === level);
    this.logger.log(levelName, msg, ...meta);
  }
}

module.exports = Driver;
