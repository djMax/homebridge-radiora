import tap from 'tap';
import hbradiora from '../index';

// I'm fully aware these aren't really proper tests. But they
// help me debug and in theory could be made into proper tests :)
const RadioRA = hbradiora.platform;

process.on('uncaughtException', (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(-1);
});

let ra;

tap.test('connect', (t) => {
  ra = new RadioRA((m) => console.log(m), {
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
  let callbacks = 0;
  ra.getDimmer(Number(process.env.RRA_TEST_DIMMER || 1), (info) => {
    t.ok(info, 'Should return a dimmer status');
    if (++callbacks === 2) {
      t.end();
    }
  });
  ra.getDimmer(Number(process.env.RRA_TEST_DIMMER || 1), (info) => {
    t.ok(info, 'Should return a dimmer status');
    if (++callbacks === 2) {
      t.end();
    }
  });
});

tap.test('should get cached status', (t) => {
  ra.getDimmer(Number(process.env.RRA_TEST_DIMMER || 1), (info) => {
    t.ok(info, 'Should return a dimmer status');
    t.end();
  });
});

tap.test('disconnect', (t) => {
  ra.disconnect();
  t.ok(true, 'Should disconnect');
  t.end();
});
