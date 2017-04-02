const term = require('terminal-kit').terminal;
const Plugins = require('js-plugins');
const Luxafor = require('luxafor')();
const async = require('async');
const usb = require('usb');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const tilde = require('tilde-expansion');

terminator = (signal) => {
    if (typeof signal === 'string') {
        console.log('exitting');
        process.exit(1);
    }
};

['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
].forEach(function(element, index, array) {
    process.on(element, () => { terminator(element); });
});

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err);
    console.log(err.stack);
});

// setup plugins
const pluginManager = new Plugins();
pluginManager.scan();

pluginManager.register('luxafor-linux-pomodoro:events', 'progress-bar', (data, globalConfig, options) => {
    const pc = globalConfig['progress-bar'] || {};

    term.on('key', (name , matches , data) => {
        if (name === 'CTRL_C') {
            term.grabInput( false ) ;
            setTimeout(() => { process.exit(); }, 100) ;
        }
    }) ;

    function progressBar(config, cb) {
        this.progressBar = term.progressBar({
            width: config.width || pc.width || 80,
            title: config.title || pc.title || 'progress',
            eta: pc.eta == null ? true : pc.eta,
            percent: pc.percent == null ? true : pc.percent,
        });

        cb();
    }

    return {
        on: (state, config) => {
            return new Promise((fulfill) => {
                progressBar.bind(this)(config, fulfill);
            });
        },
        tick: (state, config) => {
            return new Promise((fulfill) => {
                this.progressBar.update(state.progress);
                if (state.progress >= 1) {
                    term('\n');
                }

                fulfill();
            });
        },
    };
});

pluginManager.register('luxafor-linux-pomodoro:events', 'journal', (data, globalConfig, options) => {
    const pc = globalConfig['journal'] || {};
    const disabledSteps = pc.disabledSteps || [];
    const logger = new (winston.Logger)({
        transports: [ new (winston.transports.Console)({
            timestamp: () => { return new Date() },
            formatter: (options) => {
                // Return string will be passed to logger.
                const timestamp = options.timestamp();
                const level = options.level.toUpperCase();
                const msg = options.message ? options.message : '';
                const meta = options.meta && Object.keys(options.meta).length
                    ? '\n\t'+ JSON.stringify(options.meta)
                    : '';

                return `${timestamp} ${level} ${msg} ${meta}`;
            }
        })],
    });

    function isDisabled(config, disabledSteps) {
        return config.journal === false ||
            disabledSteps.indexOf(config.name) > -1;
    }

    term.on('key', (name , matches , data) => {
        if (name === 'CTRL_C') {
            term.grabInput(false) ;
            setTimeout(() => { process.exit(); }, 100) ;
        }
    }) ;

    return {
        before: (state, config) => {
            return new Promise((fulfill) => {
                if (isDisabled(config, disabledSteps) == false) {
                    logger.info('starting work');
                }

                fulfill();
            });
        },
        after: (state, config) => {
            // TODO: record this information in a file
            // TODO: where should this configuration live?
            return new Promise((fulfill) => {
                if (isDisabled(config, disabledSteps)) {
                    fulfill();
                } else {
                    term('task: ') ;
                    term.inputField({ cancelable: true }, (err, input) => {
                        term('\n');
                        logger.info(input);
                        fulfill();
                    });
                }
            });
        },
    };
});

pluginManager.register('luxafor-linux-pomodoro:events', 'luxafor-flag', (data, globalConfig, options) => {
    const pc = globalConfig['luxafor-flag'] || {};
    const defaultColour = Luxafor.colors.red;
    const colours = pc.colours || {};

    function luxaforMissing() {
        // https://github.com/dave-irvine/node-luxafor/issues/1
        // hide bug in library where it doesn't check for the
        // existence of the usb device
        return usb.findByIds(Luxafor.vid, Luxafor.pid) == null;
    }

    return {
        before: (state, config) => {
            return new Promise((fulfill) => {
                if (luxaforMissing()) {
                    fulfill();
                    return;
                }

                Luxafor.init(() => {
                    const colour = config.flagColour || colours[config.name];
                    const luxaforColour = Luxafor.colors[colour] || defaultColour;
                    Luxafor.setLuxaforColor(luxaforColour, fulfill);
                });
            });
        },
    };
});

function createSendEventFunc(plugins) {
    return function sendEvent(state, config, method, cb) {
        async.each(plugins, (plugin, pluginCb) => {
            if (plugin[method]) {
                plugin[method](state, config)
                    .then(pluginCb);
            } else {
                pluginCb();
            }
        }, cb);
    };
}

function iteration(config, sendEvent, done) {
    const name = config.name;
    const state = {
        startTime: 0,
        progress: 0,
        max: config.time,
    };

    async.waterfall([
        (cb) => { sendEvent(state, config, 'before', cb) },
        (cb) => { sendEvent(state, config, 'on', cb) },
        (cb) => {
            state.startTime = new Date() / 1000;
            const interval = setInterval(() => {
                const now = new Date() / 1000;
                const current = now - state.startTime;
                state.progress = current / state.max;

                sendEvent(state, config, 'tick', () => {
                    if (state.progress >= 1) {
                        clearInterval(interval);
                        cb();
                    }
                });
            }, 500);
        },
        (cb) => { sendEvent(state, config, 'after', cb) },
    ], done);
}

function run(config, cb) {
    pluginManager.connect(config.plugins, 'luxafor-linux-pomodoro:events', { multi: true }, (err, plugins) => {
        const sendEvent = createSendEventFunc(plugins);

        if (err) {
            winston.error('startup', err);
            return;
        }

        async.forever((next) => {
            async.eachSeries(
                config.iterations,
                (config, cb) => { iteration(config, sendEvent, cb) },
                (err) => { next(err, true) }
            );
        }, cb);
    });
}

function main() {
    const configLocation = path.resolve();

    async.waterfall([
        (cb) => {
            tilde('~/.pomodoro.json', (location) => {
                cb(null, path.resolve(location));
            });
        },
        (location, cb) => {
            fs.exists(location, (exists) => {
                cb(exists ? null : 'missing config', location);
            });
        },
        (location, cb) => {
            fs.readFile(location, 'utf8', (err, data) => {
                cb(err, JSON.parse(data));
            });
        },
        (config, cb) => {
            run(config, cb);
        },
    ], (err) => {
        console.log('fin', err);
    });
}

if (require.main === module) {
    main();
}

// TODO: write to journal file
// TODO: allow for commands to be executed on work/reset
