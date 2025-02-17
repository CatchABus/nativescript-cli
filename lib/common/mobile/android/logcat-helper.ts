import byline = require("byline");
import { DeviceAndroidDebugBridge } from "./device-android-debug-bridge";
import { ChildProcess } from "child_process";
import * as semver from "semver";
import { IDictionary } from "../../declarations";
import { IInjector } from "../../definitions/yok";
import { injector } from "../../yok";

interface IDeviceLoggingData {
	loggingProcess: ChildProcess;
	lineStream: any;
	keepSingleProcess: boolean;
}

export class LogcatHelper implements Mobile.ILogcatHelper {
	private mapDevicesLoggingData: IDictionary<IDeviceLoggingData>;

	constructor(
		private $deviceLogProvider: Mobile.IDeviceLogProvider,
		private $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		private $logger: ILogger,
		private $injector: IInjector,
		private $devicesService: Mobile.IDevicesService
	) {
		this.mapDevicesLoggingData = Object.create(null);
	}

	public async start(options: Mobile.ILogcatStartOptions): Promise<void> {
		const deviceIdentifier = options.deviceIdentifier;
		if (deviceIdentifier && !this.mapDevicesLoggingData[deviceIdentifier]) {
			this.mapDevicesLoggingData[deviceIdentifier] = {
				loggingProcess: null,
				lineStream: null,
				keepSingleProcess: options.keepSingleProcess,
			};

			const logcatStream = await this.getLogcatStream(
				deviceIdentifier,
				options.pid
			);
			const lineStream = byline(logcatStream.stdout);
			this.mapDevicesLoggingData[
				deviceIdentifier
			].loggingProcess = logcatStream;
			this.mapDevicesLoggingData[deviceIdentifier].lineStream = lineStream;
			logcatStream.stderr.on("data", (data: Buffer) => {
				this.$logger.trace("ADB logcat stderr: " + data.toString());
			});

			logcatStream.on("close", (code: number) => {
				try {
					this.forceStop(deviceIdentifier);

					if (code !== 0) {
						this.$logger.trace(
							"ADB process exited with code " + code.toString()
						);
					}
				} catch (err) {
					// Ignore the error, the process is dead.
				}
			});

			lineStream.on("data", (lineBuffer: Buffer) => {
				const lines = (lineBuffer.toString() || "").split("\n");
				for (const line of lines) {
					this.$deviceLogProvider.logData(
						line,
						this.$devicePlatformsConstants.Android,
						deviceIdentifier
					);
				}
			});
		}
	}

	public async dump(deviceIdentifier: string): Promise<void> {
		const adb: Mobile.IDeviceAndroidDebugBridge = this.$injector.resolve(
			DeviceAndroidDebugBridge,
			{ identifier: deviceIdentifier }
		);
		const logcatDumpStream = await adb.executeCommand(["logcat", "-d"], {
			returnChildProcess: true,
		});

		const lineStream = byline(logcatDumpStream.stdout);
		lineStream.on("data", (line: Buffer) => {
			const lineText = line.toString();
			this.$logger.trace(lineText);
		});

		logcatDumpStream.on("close", (code: number) => {
			logcatDumpStream.removeAllListeners();
			lineStream.removeAllListeners();
		});
	}

	/**
	 * Stops the logcat process for the specified device if keepSingleProcess is not passed on start
	 */
	public stop(deviceIdentifier: string): void {
		if (
			this.mapDevicesLoggingData[deviceIdentifier] &&
			!this.mapDevicesLoggingData[deviceIdentifier].keepSingleProcess
		) {
			this.forceStop(deviceIdentifier);
		}
	}

	private forceStop(deviceIdentifier: string): void {
		this.mapDevicesLoggingData[
			deviceIdentifier
		].loggingProcess.removeAllListeners();
		this.mapDevicesLoggingData[deviceIdentifier].loggingProcess.kill("SIGINT");
		this.mapDevicesLoggingData[
			deviceIdentifier
		].lineStream.removeAllListeners();
		delete this.mapDevicesLoggingData[deviceIdentifier];
	}

	private async getLogcatStream(deviceIdentifier: string, pid?: string) {
		const device = await this.$devicesService.getDevice(deviceIdentifier);
		const minAndroidWithLogcatPidSupport = "7.0.0";
		const isLogcatPidSupported =
			!!device.deviceInfo.version &&
			semver.gte(
				semver.coerce(device.deviceInfo.version),
				minAndroidWithLogcatPidSupport
			);
		const adb: Mobile.IDeviceAndroidDebugBridge = this.$injector.resolve(
			DeviceAndroidDebugBridge,
			{ identifier: deviceIdentifier }
		);
		const logcatCommand = ["logcat"];

		if (pid && isLogcatPidSupported) {
			logcatCommand.push(`--pid=${pid}`);
		}
		const logcatStream = await adb.executeCommand(logcatCommand, {
			returnChildProcess: true,
		});
		return logcatStream;
	}
}

injector.register("logcatHelper", LogcatHelper);
