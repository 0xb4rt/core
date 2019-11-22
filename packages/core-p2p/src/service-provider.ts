import { Container, Providers } from "@arkecosystem/core-kernel";

import { EventListener } from "./event-listener";
import { NetworkMonitor } from "./network-monitor";
import { PeerCommunicator } from "./peer-communicator";
import { PeerConnector } from "./peer-connector";
import { PeerProcessor } from "./peer-processor";
import { PeerStorage } from "./peer-storage";
import { startSocketServer } from "./socket-server";
import { payloadProcessor } from "./socket-server/payload-processor";

export class ServiceProvider extends Providers.ServiceProvider {
    public async register(): Promise<void> {
        this.registerServices();

        if (process.env.DISABLE_P2P_SERVER) {
            return;
        }

        this.app.get<NetworkMonitor>(Container.Identifiers.PeerNetworkMonitor).setServer(
            await startSocketServer(
                this.app,
                {
                    storage: this.app.get<PeerStorage>(Container.Identifiers.PeerStorage),
                    connector: this.app.get<PeerConnector>(Container.Identifiers.PeerConnector),
                    communicator: this.app.get<PeerCommunicator>(Container.Identifiers.PeerCommunicator),
                    processor: this.app.get<PeerProcessor>(Container.Identifiers.PeerProcessor),
                    networkMonitor: this.app.get<NetworkMonitor>(Container.Identifiers.PeerNetworkMonitor),
                },
                this.config().all(),
            ),
        );

        payloadProcessor.init();
    }

    public async dispose(): Promise<void> {
        this.app.get<NetworkMonitor>(Container.Identifiers.PeerNetworkMonitor).stopServer();
    }

    public async required(): Promise<boolean> {
        return true;
    }

    private registerServices(): void {
        this.app
            .bind(Container.Identifiers.PeerStorage)
            .to(PeerStorage)
            .inSingletonScope();

        this.app
            .bind(Container.Identifiers.PeerConnector)
            .to(PeerConnector)
            .inSingletonScope();

        this.app
            .bind(Container.Identifiers.PeerCommunicator)
            .to(PeerCommunicator)
            .inSingletonScope();

        this.app
            .bind(Container.Identifiers.PeerProcessor)
            .to(PeerProcessor)
            .inSingletonScope();

        this.app
            .bind(Container.Identifiers.PeerNetworkMonitor)
            .to(NetworkMonitor)
            .inSingletonScope();

        this.app.get<NetworkMonitor>(Container.Identifiers.PeerNetworkMonitor).init();

        this.app.get<PeerCommunicator>(Container.Identifiers.PeerCommunicator).init();

        this.app.get<PeerProcessor>(Container.Identifiers.PeerProcessor).init();

        this.app
            .bind("p2p.event-listener")
            .to(EventListener)
            .inSingletonScope();
    }
}
