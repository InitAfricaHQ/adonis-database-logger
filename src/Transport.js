/**
 * @forked
 * @module 'winston-sql-transport'
 * @fileoverview Winston universal SQL transport for logging
 * @license MIT
 * @author Andrei Tretyakov <andrei.tretyakov@gmail.com>
 */

const circularJSON = require('circular-json');
const knex = require('knex');
const moment = require('moment');
const { Stream } = require('stream');
const { Transport } = require('winston');


class Transport extends Transport {
  /**
   * Constructor for the universal transport object.
   * @constructor
   * @param {Object} options
   * @param {string} options.client - Database client
   * @param {string} options.connectionString - Database connection uri
   * @param {string} [options.label] - Label stored with entry object if defined.
   * @param {string} [options.level=info] - Level of messages that this transport
   * should log.
   * @param {string} [options.name] - Transport instance identifier. Useful if you
   * need to create multiple universal transports.
   * @param {boolean} [options.silent=false] - Boolean flag indicating whether to
   * suppress output.
   * @param {string} [options.tableName=app_logs] - The name of the table you
   * want to store log messages in.
   */
  constructor(options = {}) {
    super();
    this.name = 'DatabaseTransport';

    //
    // Configure your storage backing as you see fit
    //
    if (!options.client) {
      throw new Error('You have to define client');
    }

    const connection = options.connection || {};


    this.client = knex({
      client: options.client,
      connection,
      useNullAsDefault: true
    });

    this.label = options.label || '';

    //
    // Set the level from your options
    //
    this.level = options.level || 'info';

    this.silent = options.silent || false;

    this.tableName = options.tableName || 'app_logs';

    this.daysToKeep = options.daysToKeep || null
    this.lastId = 0;
    this.init();
  }

  /**
   * Cleanup function, used for log rotation.
   * It executes based on a random number between 0 and 10. It only fires when the random number is 7.
   * Also, it needs to have a daysToKeep configuration option set
   *
   * @private
   */
  _cleanup() {
    if (this.daysToKeep === null) {
      return;
    }

    const random = Math.floor(Math.random() * 10);

    if (random !== 7) {
      return;
    }

    this.client(this.tableName)
      .where('timestamp', '<', moment().utc().subtract(this.daysToKeep, 'day').format('YYYY-MM-DD HH:mm:ss'))
      .del()
      .then((r) => {

      });
  }

  /**
   * Create logs table.
   * @return {Promise} result of creation within a Promise
   */
  init() {
    const { client, tableName } = this;
    const self = this;
    self.lastId = 0;

    client.schema.hasTable(tableName).then((exists) => {
      if (!exists) {
        return client.schema.createTable(tableName, (table) => {
          table.increments('id').primary();
          table.string('level');
          table.string('message');
          table.timestamp('timestamp').defaultTo(client.fn.now());
        });
      }
      client
        .select('id')
        .from(tableName)
        .orderBy('id', 'desc')
        .limit(1)
        .then((r) => {
          if (r.length > 0) {
            self.lastId = r[0].id;
          }
        });

      self._cleanup();
    });
  }

  /**
   * Core logging method exposed to Winston. Metadata is optional.
   * @param {Object} info - TODO: add param description.
   * @param {Function} callback - TODO: add param description.
   */
  log(info, callback) {
    setImmediate(() => this.emit('logged', info));

    const { client, tableName } = this;
    const self = this;

    this._cleanup();

    return client
      .insert(info)
      .into(tableName)
      .then(() => {
        client
          .select('id')
          .from(tableName)
          .orderBy('id', 'desc')
          .limit(1)
          .then((r) => {
            self.lastId = r[0].id;
          });
        callback(null, true);
      })
      .catch(err => callback(err));
  }

  /**
   * Query the transport. Options object is optional.
   * @param {Object} options - Loggly-like query options for this instance.
   * @param {string} [options.from] - Start time for the search.
   * @param {string} [options.until=now] - End time for the search. Defaults to "now".
   * @param {string} [options.rows=100] - Limited number of rows returned by search. Defaults to 100.
   * @param {string} [options.order=desc] - Direction of results returned, either "asc" or "desc".
   * @param {string} [options.fields]
   * @param {Function} callback - Continuation to respond to when complete.
   */
  query(...args) {
    let options = args.shift() || {};
    let callback = args.shift();

    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    options.fields = options.fields || [];

    let query = this.client
      .select(options.fields)
      .from(this.tableName);

    if (options.from && options.until) {
      query = query.whereBetween('timestamp', [
        moment(options.from).utc().format('YYYY-MM-DD HH:mm:ss'),
        moment(options.until).utc().format('YYYY-MM-DD HH:mm:ss')
      ]);
    }

    if (options.rows) {
      query = query.limit(options.rows);
    }

    if (options.order) {
      query = query.orderBy('timestamp', options.order);
    }

    query
      .then((data) => {
        callback(null, data);
      })
      .catch(callback);
  }

  /**
   * Returns a log stream for this transport. Options object is optional.
   * @param {Object} options - Stream options for this instance.
   * @param {Stream} stream - Pass in a pre-existing stream.
   * @return {Stream}
   */
  stream(...args) {
    const options = args.shift() || {};
    const stream = args.shift() || new Stream();

    const self = this;

    let start = (typeof options.start === 'undefined') ? null : options.start;
    const row = 0;

    if (start === -1) {
      start = null;
    }

    let lastId = 0;
    if (start === null) {
      lastId = this.lastId - 1;
    } else {
      lastId = start;
    }

    stream.destroy = function destroy() {
      this.destroyed = true;
    };

    function poll() {
      self.client
        .select()
        .from(self.tableName)
        .where('id', '>', lastId)
        .then((results) => {
          if (stream.destroyed) {
            return null;
          }

          results.forEach((log) => {
            stream.emit('log', log);

            lastId = log.id;
          });

          return setTimeout(poll, 2000);
        })
        .catch((error) => {
          if (stream.destroyed) {
            return;
          }
          stream.emit('error', error);
          setTimeout(poll, 2000);
        });
    }

    // we need to poll here.
    poll(start);

    return stream;
  }
}

module.exports = { DatabaseTransport: Transport };
