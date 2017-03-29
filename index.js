const term = require('terminal-kit').terminal;
const Plugins = require('js-plugins');
const Luxafor = require('luxafor')();
const async = require('async');
const usb = require('usb');

terminator = (signal) => {
    if (typeof signal === 'string') {
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
});

// setup plugins
const pluginManager = new Plugins();
pluginManager.scan();

pluginManager.register('luxafor-linux-pomodoro:events', 'ProgressBar', () => {
    term.on('key', (name , matches , data) => {
        if (name === 'CTRL_C') {
            term.grabInput( false ) ;
            setTimeout(() => { process.exit(); }, 100) ;
        }
    }) ;

    function progressBar(conf, cb) {
        this.progressBar = term.progressBar({
            width: 80,
            title: conf.title,
            eta: true,
            percent: true,
        });

        cb();
    }

    return {
        work: (conf) => {
            return new Promise((fulfill) => {
                progressBar.bind(this)(conf, fulfill);
            });
        },
        rest: (conf) => {
            return new Promise((fulfill) => {
                progressBar.bind(this)(conf, fulfill);
            });
        },
        tick: (event) => {
            return new Promise((fulfill) => {
                this.progressBar.update(event.progress);
                if (event.progress >= 1) {
                    term('\n');
                }

                fulfill();
            });
        },
    };
});

pluginManager.register('luxafor-linux-pomodoro:events', 'journal', () => {
    term.on('key', (name , matches , data) => {
        if (name === 'CTRL_C') {
            term.grabInput( false ) ;
            setTimeout(() => { process.exit(); }, 100) ;
        }
    }) ;

    return {
        beforerest: (conf) => {
            // TODO record this information in a file
            return new Promise((fulfill) => {
                term('what awesomeness have you demonstrated: ') ;
                term.inputField({ cancelable: true }, (err, input) => {
                    term('\n');
                    fulfill();
                });
            });
        },
    };
});

// most of this is just configuration rather than code
// remove the precise task such as 'beforework' and
// only implement 'before', 'on', 'tick', 'after' then
// use the configuration object for colours, etc
pluginManager.register('luxafor-linux-pomodoro:events', 'luxafor-flag', () => {
    function luxaforMissing() {
        // https://github.com/dave-irvine/node-luxafor/issues/1
        // hide bug in library where it doesn't check for the
        // existence of the usb device
        return usb.findByIds(Luxafor.vid, Luxafor.pid) == null;
    }

    return {
        beforework: (conf) => {
            return new Promise((fulfill) => {
                if (luxaforMissing()) {
                    fulfill();
                    return;
                }

                Luxafor.init(() => {
                    Luxafor.setLuxaforColor(Luxafor.colors.red, fulfill);
                });
            });
        },
        beforerest: (conf) => {
            return new Promise((fulfill) => {
                if (luxaforMissing()) {
                    fulfill();
                    return;
                }

                Luxafor.init(() => {
                    Luxafor.setLuxaforColor(Luxafor.colors.green, fulfill);
                });
            });
        },
    };
});

function sendEvent(state, method, cb) {
    pluginManager.connect({}, 'luxafor-linux-pomodoro:events', { multi: true }, (err, plugins) => {
        async.each(plugins, (plugin, pluginCb) => {
            if (plugin[method]) {
                plugin[method](state).then(pluginCb);
            } else {
                pluginCb();
            }
        }, cb);
    });
}

function iteration(conf, done) {
    const name = conf.name;
    const state = {
        startTime: 0,
        progress: 0,
        max: conf.time,
    };

    // TODO: implement before, on, tick, after
    async.waterfall([
        (cb) => {
            sendEvent(conf, `before${name}`, () => { cb(); });
        },
        (cb) => {
            sendEvent(conf, name, () => { cb(); });
        },
        (cb) => {
            state.startTime = new Date() / 1000;
            const interval = setInterval(() => {
                const now = new Date() / 1000;
                const current = now - state.startTime;
                state.progress = current / state.max;

                sendEvent(state, 'tick', () => {
                    if (state.progress >= 1) {
                        clearInterval(interval);
                        cb();
                    }
                });
            }, 500);
        },
        (cb) => {
            sendEvent(state, `after${name}`, cb);
        },
    ], done);
}

function main() {
    const config = {
        work: { name: 'work', title: 'working: ', time: 5 },
        rest: { name: 'rest', title: 'resting: ', time: 10 },
    };

    async.forever((next) => {
        // TODO use the configuration and eachSeries
        async.waterfall([
            (cb) => { iteration(config.work, cb); },
            (cb) => { iteration(config.rest, cb); },
        ], (err) => { next(err, true); });
    }, (err) => {
        console.log('fin', err);
    });
}

if (require.main === module) {
    main();
}

// TODO: load configuration from file
// TODO: record start/end times and job complete
// TODO: allow for commands to be executed on work/reset
// TODO: configuration for work/rest times
// TODO: catch terminate signal
