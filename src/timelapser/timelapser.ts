import {ProtectApi, ProtectCameraConfig} from "unifi-protect";
import {AppConfig} from "../appconfig";
import {EventEmitter} from 'node:events'
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {inflate} from "../path-template";

type TimelapseConfig = {
    cameras: string[],
    width: number,
    height: number,
    length: number,
    startAt: string,
}

export default class Timelapser {
    private readonly _events = new EventEmitter();
    private readonly _timelapseLastFrame = new Map<string, string>();
    private _isRunning = false;

    constructor(private _protect : ProtectApi,
                private _appconfig : AppConfig) {
        setInterval(() => {
            this._tick();
        }, 5 * 60 * 1000);

        setTimeout(() => {
            this._tick();
        }, 5000)
    }

    async _tick() {
        if (!this._protect.bootstrap) return;
        if (this._isRunning) return;

        this._isRunning = true;

        try {
            await fs.mkdir('timelapses', { recursive: true });

            for (let index = 0; index < this._appconfig.timelapses.length; index++) {
                const timelapse = this._appconfig.timelapses[index];
                const cameraId = timelapse.cameras[0];

                if (!cameraId) {
                    console.warn(`Timelapse ${index} has no cameras configured.`);
                    continue;
                }

                const camera = this._protect.bootstrap.cameras.find(c => c.id == cameraId);
                if (!camera) {
                    console.warn(`Timelapse ${index} couldn't find camera: ${cameraId}`);
                    continue;
                }

                await this._processTimelapse(index, camera, timelapse);
            }
        } finally {
            this._isRunning = false;
        }
    }

    private async _processTimelapse(index: number, camera: ProtectCameraConfig, timelapse: TimelapseConfig) {
        console.log(`Generating timelapse ${index} (${camera.name})...`)

        const snapshotDir = path.resolve(this._appconfig.snapshotDirectory, camera.name ?? camera.id);
        try {
            await fs.access(snapshotDir);
        } catch (error) {
            console.warn(`Snapshot directory missing for camera ${camera.name}: ${snapshotDir}`);
            return;
        }

        const windowStart = this._getWindowStart(timelapse);
        const windowEnd = new Date(windowStart.getTime() + (timelapse.length * 1000));

        const entries = await fs.readdir(snapshotDir, {recursive: true});
        const fileEntries = await Promise.all(entries.map(async (file) => {
            if (!file.toLowerCase().endsWith('.jpg')) {
                return null;
            }

            const filePath = path.join(snapshotDir, file);
            try {
                const stats = await fs.stat(filePath);
                const createdAtMs = stats.birthtimeMs || stats.ctimeMs;

                if (!this._dateInWindow(new Date(createdAtMs), windowStart, windowEnd)) {
                    return null;
                }

                return { file, createdAtMs };
            } catch (error) {
                return null;
            }
        }));

        const files = fileEntries
            .filter((entry): entry is { file: string; createdAtMs: number } => !!entry)
            .sort((a, b) => a.createdAtMs - b.createdAtMs)
            .map(entry => entry.file);

        if (!files.length) return;

        const timelapseKey = this._getTimelapseKey(index, camera.id, windowStart);
        const lastFrame = this._timelapseLastFrame.get(timelapseKey);
        let newFiles = files;

        if (lastFrame) {
            const lastIndex = files.indexOf(lastFrame);
            if (lastIndex >= 0) {
                newFiles = files.slice(lastIndex + 1);
            }
        }

        if (!newFiles.length) return;

        const outputPath = this._getTimelapseOutputPath(index, camera.name ?? camera.id, windowStart);
        const segmentPath = path.resolve('timelapses', `segment-${index}-${Date.now()}.mkv`);
        const frameListPath = path.resolve('timelapses', `frames-${index}-${Date.now()}.txt`);

        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        try {
            await this._writeConcatList(
                frameListPath,
                newFiles.map(file => path.join(snapshotDir, file))
            );

            await this._createSegment(frameListPath, segmentPath, timelapse);

            if (await this._fileExists(outputPath)) {
                const concatListPath = path.resolve('timelapses', `concat-${index}-${Date.now()}.txt`);
                const tempOutput = path.resolve('timelapses', `timelapse-${index}-${Date.now()}.mkv`);

                try {
                    await this._writeConcatList(concatListPath, [outputPath, segmentPath]);
                    await this._runFfmpeg([
                        "-hide_banner",
                        "-loglevel", "error",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concatListPath,
                        "-c", "copy",
                        tempOutput
                    ]);

                    await fs.rename(tempOutput, outputPath);
                } finally {
                    await this._safeUnlink(concatListPath);
                    await this._safeUnlink(tempOutput);
                }
            } else {
                await fs.rename(segmentPath, outputPath);
            }

            this._timelapseLastFrame.set(timelapseKey, newFiles[newFiles.length - 1]);
        } catch (error) {
            console.error(`Failed to update timelapse ${index} for camera ${camera.name}.`, error);
        } finally {
            await this._safeUnlink(frameListPath);
            await this._safeUnlink(segmentPath);
        }
    }

    private async _createSegment(frameListPath: string, outputPath: string, timelapse: TimelapseConfig) {
        const args = [
            "-hide_banner",
            "-loglevel", "error",
            "-r", "30",
            "-f", "concat",
            "-safe", "0",
            "-i", frameListPath,
        ];

        if (timelapse.width && timelapse.height) {
            args.push("-vf", `scale=${timelapse.width}:${timelapse.height}`);
        }

        args.push(
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            outputPath
        );

        await this._runFfmpeg(args);
    }

    private _getTimelapseKey(index: number, cameraId: string, windowStart: Date) {
        return `${index}:${cameraId}:${windowStart.toISOString()}`;
    }

    private _getTimelapseOutputPath(index: number, cameraName: string, windowStart: Date) {
        const vars = new Map<string, string>();
        vars.set('id', index.toString());
        vars.set('name', cameraName);
        vars.set('date', this._formatTimestamp(windowStart));

        const timelapsePath = inflate(this._appconfig.timelapseFileName, vars, windowStart);
        return path.resolve(this._appconfig.timelapseDirectory, timelapsePath);
    }

    private _getWindowStart(timelapse: TimelapseConfig) {
        const startAt = new Date(timelapse.startAt);
        const now = new Date();

        if (now <= startAt) {
            return startAt;
        }

        const lengthMs = timelapse.length * 1000;
        const deltaMs = now.getTime() - startAt.getTime();
        const windows = Math.floor(deltaMs / lengthMs);

        return new Date(startAt.getTime() + (windows * lengthMs));
    }

    private _dateInWindow(fileDate: Date, windowStart: Date, windowEnd: Date) {
        if (Number.isNaN(fileDate.getTime())) {
            return false;
        }

        return fileDate >= windowStart && fileDate < windowEnd;
    }

    private _formatTimestamp(date: Date) {
        return date.toISOString()
            .replaceAll(':', '_')
            .replaceAll('T', ' ')
            .replaceAll('Z', '');
    }

    private async _fileExists(filePath: string) {
        try {
            await fs.access(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    private async _writeConcatList(filePath: string, files: string[]) {
        const formatted = files
            .map(file => this._formatFfmpegPath(file))
            .map(file => `file '${file}'`)
            .join('\n');

        await fs.writeFile(filePath, formatted);
    }

    private _formatFfmpegPath(filePath: string) {
        return filePath
            .replace(/\\/g, '/')
            .replace(/'/g, "\\'");
    }

    private async _safeUnlink(filePath: string) {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            return;
        }
    }

    private async _runFfmpeg(args: string[]) {
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", args);

            const stderrChunks: Buffer[] = [];

            ffmpeg.stderr.on('data', (chunk: Buffer) => {
                stderrChunks.push(chunk);
            });

            ffmpeg.on('error', reject);

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }

                const stderr = Buffer.concat(stderrChunks).toString().trim();
                reject(new Error(stderr || `ffmpeg exited with code ${code}`));
            });
        });
    }
}
