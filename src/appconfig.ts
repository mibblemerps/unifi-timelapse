import fs from 'node:fs'
import {EventEmitter} from 'node:events'

export class AppConfig {
    private readonly _events = new EventEmitter();

    unifiIp: string | null = null;
    unifiUsername: string | null = null;
    unifiPassword: string | null = null;

    snapshotDirectory: string = 'snapshots';
    snapshotFileName: string = '%date%.jpg';

    timelapseDirectory: string = 'timelapses';
    timelapseFileName: string = '%id% %name%/%date%.mkv';

    cameras: {
        camera: string,
        interval: number,
        startAt: string,
        quality: string | null,
    }[] = [];

    timelapses: {
        cameras: string[],
        width: number,
        height: number,
        length: number,
        startAt: string,
    }[] = [];

    constructor() {

    }

    onChanged(listener: (config: AppConfig) => void) {
        this._events.on('changed', listener);
    }

    notifyChanged() {
        this._events.emit('changed', this);
    }

    save() {
        fs.writeFileSync('appconfig.json', JSON.stringify(this, (key, value) => {
            if (key === '_events') {
                return undefined;
            }
            return value;
        }, 2));
    }

    load() {
        try {
            fs.accessSync('appconfig.json', fs.constants.R_OK)
        } catch (e) {
            return; // no appconfig.json
        }

        let json = fs.readFileSync('appconfig.json').toString();
        Object.assign(this, JSON.parse(json));

        this.notifyChanged();
    }

}

const config = new AppConfig();

export default config;
