import {Nullable, ProtectApi, ProtectCameraConfig} from "unifi-protect";
import {AppConfig} from "../appconfig";
import {extractFrame} from "./frame-extractor";
import fs from 'node:fs/promises';
import path from 'node:path';
import {inflate} from "../path-template";

/**
 * Handles taking snapshots from cameras.
 */
export default class Snapshots {
    _cameraNextSnapshot: Map<string, Date> = new Map();

    constructor(private _protect : ProtectApi,
                private _appconfig : AppConfig) {
        setInterval(() => {
            this._tick();
        }, 1000);
    }

    public getSnapshotPath(camera: ProtectCameraConfig, date: Date) {
        return path.join(this._appconfig.snapshotDirectory, camera.name ?? camera.id, this._inflatePathTemplate(this._appconfig.snapshotFileName, camera, date));
    }

    async _tick() {
        if (!this._protect.bootstrap) return;

        for (let cameraConfig of this._appconfig.cameras) {
            const nextTime = this._getNextSnapshotTime(cameraConfig.camera);

            if (nextTime && new Date() >= nextTime) {
                // Time to take snapshot
                this._incrementNextSnapshotTime(cameraConfig.camera);

                let camera = this._protect.bootstrap.cameras.find(c => c.id == cameraConfig.camera);

                if (!camera) {
                    console.warn(`Camera ${cameraConfig.camera} not found`);
                    continue;
                }

                console.log(`[${new Date().toISOString()}] Taking snapshot of ${camera.name}... (next snapshot: ${this._getNextSnapshotTime(cameraConfig.camera)})`);
                try {
                    let snapshot = await this.takeSnapshot(camera, cameraConfig.quality);
                    await this.storeSnapshot(camera, snapshot);
                } catch (error) {
                    console.error(`Error snapshotting ${camera.name}!` ,error);
                }
            }
        }
    }

    async takeSnapshot(camera: ProtectCameraConfig, quality: string | null) {
        let channel = camera.channels[0].id;
        if (!quality) {
            channel = camera.channels.find(v => v.name == quality)?.id ?? channel;
        }

        const livestream = this._protect.createLivestream();
        await livestream.start(camera.id, channel, { useStream: true });

        const stream = livestream.stream;
        if (!stream) {
            livestream.stop();
            throw new Error("Livestream did not provide a stream.");
        }

        try {
            return await extractFrame(stream);
        } finally {
            livestream.stop();
        }
    }

    async storeSnapshot(camera: ProtectCameraConfig, snapshot: Buffer<ArrayBufferLike>) {
        const snapshotPath = this.getSnapshotPath(camera, new Date());
        await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
        await fs.writeFile(snapshotPath, snapshot);
    }

    _incrementNextSnapshotTime(cameraId: string) {
        const config = this._appconfig.cameras.find(c => c.camera == cameraId)!;

        // Increment next snapshot time
        if (this._cameraNextSnapshot.has(cameraId)) {
            const nextSnapshot = this._cameraNextSnapshot.get(cameraId)!;
            nextSnapshot.setSeconds(nextSnapshot.getSeconds() + config.interval);
            this._cameraNextSnapshot.set(cameraId, nextSnapshot);
        }

    }

    _getNextSnapshotTime(cameraId: string) {
        const cameraConf = this._appconfig.cameras.find(c => c.camera == cameraId)!;

        if (this._cameraNextSnapshot.has(cameraId)) {
            return this._cameraNextSnapshot.get(cameraId);
        } else {
            const startTime = new Date(
                cameraConf?.startAt ?? new Date().toISOString());

            const delta = ((new Date().getTime() / 1000) + 5) - (startTime.getTime() / 1000);

            const nextSnapshotTime = new Date(cameraConf.startAt);
            nextSnapshotTime.setSeconds(nextSnapshotTime.getSeconds() + (Math.ceil(delta / cameraConf.interval) * cameraConf.interval));

            this._cameraNextSnapshot.set(cameraId, nextSnapshotTime);

            return nextSnapshotTime;
        }
    }

    _inflatePathTemplate(str: string, camera: ProtectCameraConfig, date: Nullable<Date>): string {
        let vars = new Map<string, string>();

        vars.set('camera', camera.name ?? camera.id);
        vars.set('id', camera.id);

        return inflate(str, vars, date);
    }
}