import "jest-extended";

import { Application } from "@packages/core-kernel/src/application";
import { Container, Identifiers } from "@packages/core-kernel/src/ioc";
import { ServiceProvider } from "@packages/core-kernel/src/services/log";
import { PinoLogger } from "@packages/core-kernel/src/services/log/drivers/pino";
import { ConfigRepository } from "@packages/core-kernel/src/services/config";
import { dirSync, setGracefulCleanup } from "tmp";

let app: Application;

beforeAll(() => setGracefulCleanup());

beforeEach(() => {
    app = new Application(new Container());
    app.bind(Identifiers.ApplicationNamespace).toConstantValue("ark-jestnet");
    app.get<ConfigRepository>(Identifiers.ConfigRepository).merge({
        app: {
            services: {
                log: {
                    levels: {
                        console: process.env.CORE_LOG_LEVEL || "emergency",
                        file: process.env.CORE_LOG_LEVEL_FILE || "emergency",
                    },
                    fileRotator: {
                        interval: "1s",
                    },
                },
            },
        },
    });

    app.useLogPath(dirSync().name);
});

describe("LogServiceProvider", () => {
    it(".register", async () => {
        expect(app.isBound(Identifiers.LogManager)).toBeFalse();
        expect(app.isBound(Identifiers.LogService)).toBeFalse();

        await app.resolve<ServiceProvider>(ServiceProvider).register();

        expect(app.isBound(Identifiers.LogManager)).toBeTrue();
        expect(app.isBound(Identifiers.LogService)).toBeTrue();
        expect(app.get(Identifiers.LogService)).toBeInstanceOf(PinoLogger);
    });
});
