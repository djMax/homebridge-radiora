import tap from 'tap';
import hbradiora from '../index';

const RadioRA = hbradiora.platform;

process.on('uncaughtException', (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(-1);
});

let ra;

tap.test('connect', (t) => {
  ra = new RadioRA(() => {}, {
    username: process.env.RRA_USER || 'lutron',
    password: process.env.RRA_PASS || 'integration',
    host: process.env.RRA_HOST || 'lutron',
  });

  ra.on('loggedIn', () => {
    t.ok(true, 'Should login to controller');
    t.end();
  });
});

tap.test('should get a dimmer', (t) => {
  ra.getDimmer(Number(process.env.RRA_TEST_DIMMER), (info) => {
    t.ok(info, 'Should return a dimmer status');
    t.end();
  });
});

tap.test('disconnect', (t) => {
  ra.disconnect();
  t.ok(true, 'Should disconnect');
  t.end();
});
