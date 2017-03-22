const term = require('terminal-kit').terminal;

function ProgressBar(config) {
    const progressBar = term.progressBar({
        width: 80,
        title: config.title,
        eta: true,
        percent: true,
    });

    const state = { progress: 0 };
    const startTime = new Date() / 1000;
    const max = config.time;

    function doProgress(fulfill) {
        const now = new Date() / 1000;
        const current = now - startTime;
        state.progress = current / max;
        progressBar.update(state.progress);

        if (state.progress >= 1) {
            term('\n');
            fulfill();
        } else {
            setTimeout(() => { doProgress(fulfill); }, 100);
        }
    }

    return new Promise((fulfill) => {
        doProgress(fulfill);
    });
}

const restConfig = { title: 'resting: ', time: 3 };
const workConfig = { title: 'working: ', time: 3 };

ProgressBar(workConfig).then(() => ProgressBar(restConfig)).then(() => {
    term('job complete: ');
    return new Promise((fulfill) => {
        term.inputField({ }, (error, response) => {
            console.log('response: ', response);
            fulfill();
        });
    });
}).then(() => {
    process.exit();
});


// TODO: continous iterations
// TODO: record start/end times and job complete
// TODO: allow for commands to be executed on work/reset
// TODO: configuration for work/rest times
// TODO: catch terminate signal
