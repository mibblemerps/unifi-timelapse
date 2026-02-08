import appconfig from "./appconfig";
import {ProtectApi} from "unifi-protect";
import Snapshots from "./snapshots/snapshots";
import Timelapser from "./timelapser/timelapser";
import fs from 'node:fs/promises';

const protect = new ProtectApi();

async function startup() {
    console.log('UniFi Timelapse');

    try {
        appconfig.load();
    } catch (error) {
        console.warn('Failed to load configuration. ', error);
        return;
    }

    appconfig.save();

    appconfig.onChanged(async () => {
        await protect.login(appconfig.unifiIp!, appconfig.unifiUsername!, appconfig.unifiPassword!);
        await protect.getBootstrap();
        console.log(`Logged into ${appconfig.unifiIp} as ${appconfig.unifiUsername}`);

        for (let camera of protect.bootstrap?.cameras ?? []) {
            console.log('Found camera: ' + camera.name + '\t ' + camera.id)
        }
    });

    console.log('Loaded app config');

    const snapshots = new Snapshots(protect, appconfig);
    const timelapser = new Timelapser(protect, appconfig);

    // hasn't changed, but we call once everything is loaded so modules can load their initial configuration
    appconfig.notifyChanged();

    // setTimeout(async () => {
    //     let snapshot = await snapshots.takeSnapshot(protect.bootstrap!.cameras[4], "High");
    //     await fs.writeFile('test.jpg', snapshot);
    // }, 3000);
}

startup().catch(e => { console.error(e); });



