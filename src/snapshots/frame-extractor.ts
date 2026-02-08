import {spawn} from "node:child_process";
import {Readable} from "node:stream";

/**
 * Extracts the first frame from a video stream using ffmpeg.
 *
 * @param stream
 * @return JPEG frame
 */
export async function extractFrame(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
            "-hide_banner",
            "-loglevel", "error",
            "-i", "pipe:0",
            "-frames:v", "1",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "pipe:1"
        ]);

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        ffmpeg.stdout.on("data", (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        ffmpeg.stderr.on("data", (chunk: Buffer) => {
            stderrChunks.push(chunk);
        });

        ffmpeg.on("error", (error) => {
            reject(error);
        });

        ffmpeg.on("close", (code) => {
            stream.unpipe(ffmpeg.stdin);
            ffmpeg.stdin.end();
            stream.destroy();

            const output = Buffer.concat(stdoutChunks);
            if (code !== 0 || output.length === 0) {
                const stderr = Buffer.concat(stderrChunks).toString().trim();
                reject(new Error(stderr || `ffmpeg exited with code ${code}`));
                return;
            }

            resolve(output);
        });

        stream.on("error", (error) => {
            ffmpeg.stdin.destroy(error);
        });

        ffmpeg.stdin.on("error", (error: NodeJS.ErrnoException) => {
            if (error && (error.code === "EPIPE" || error.code === "EOF")) {
                return;
            }

            reject(error);
        });

        stream.pipe(ffmpeg.stdin);
    });
}
