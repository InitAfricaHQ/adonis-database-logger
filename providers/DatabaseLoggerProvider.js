const { ServiceProvider } = require('@adonisjs/fold');

class DatabaseLogProvider extends ServiceProvider {
  register() {
    this.app.extend('Adonis/Src/Logger', 'database', () => {
      const DatabaseDriver = require('../src/Driver');
      return new DatabaseDriver();
    });
  }
}

module.exports = DatabaseLogProvider;
