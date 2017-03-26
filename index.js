const term = require('terminal-kit').terminal;
const Plugins = require('js-plugins');
const async = require('async');

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// setup plugins
const pluginManager = new Plugins();
pluginManager.scan();

// register progress bar plugin
// TODO: make this more generic, rest & work are pretty much the same
// just use before and after then send in the stage name within the event
pluginManager.register('luxafor-linux-pomodoro:events', 'ProgressBar', () => ({
    beforeWork: (conf) => {
        Promise((fulfill) => {
            this.progressBar = term.progressBar({
                width: 80,
                title: conf.title,
                eta: true,
                percent: true,
            });

            fulfill();
        });
    },
    beforeRest: (conf) => {
        Promise((fulfill) => {
            this.progressBar = term.progressBar({
                width: 80,
                title: conf.title,
                eta: true,
                percent: true,
            });

            fulfill();
        });
    },
    tick: (event) => {
        Promise((fulfill) => {
            this.progressBar.update(event.progress);
            fulfill();
        });
    },
    afterRest: () => {
        Promise((fulfill) => {
            term('\n');
            fulfill();
        });
    },
    afterWork: () => {
        Promise((fulfill) => {
            term('\n');
            fulfill();
        });
    },
}));


function sendEvent(state, method, cb) {
    pluginManager.connect({}, 'luxafor-linux-pomodoro:events', { multi: true }, (err, plugins) => {
        async.each(plugins, (plugin, pluginCb) => {
            plugin[method](state).then(pluginCb);
        }, cb);
    });
}

function iteration(conf, done) {
    const name = capitalizeFirstLetter(conf.name);
    const state = {
        startTime: 0,
        progress: 0,
        max: conf.time,
    };

    async.waterfall([
        (cb) => {
            sendEvent(conf, `before${name}`, cb);
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
        rest: { name: 'rest', title: 'resting: ', time: 10 },
        work: { name: 'work', title: 'working: ', time: 5 },
    };


    async.forever((next) => {
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
