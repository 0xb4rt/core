import { ConnectionManager, databaseServiceFactory } from "@arkecosystem/core-database";
import { Container, Contracts, Providers } from "@arkecosystem/core-kernel";
import { Wallets } from "@arkecosystem/core-state";

import { PostgresConnection } from "./postgres-connection";

// todo: review the implementation
export class ServiceProvider extends Providers.ServiceProvider {
    public async register(): Promise<void> {
        this.app.log.info("Establishing Database Connection");

        const walletRepository = this.app.resolve<Wallets.WalletRepository>(Wallets.WalletRepository).init();
        const walletState = this.app.resolve<Wallets.WalletState>(Wallets.WalletState).init(walletRepository);

        const pg = this.app.resolve(PostgresConnection);

        const connectionManager = this.app.get<ConnectionManager>(Container.Identifiers.DatabaseManager);
        const connection = await connectionManager.createConnection(
            await pg.setup(this.config().all(), walletRepository, walletState),
        );

        this.app
            .bind(Container.Identifiers.DatabaseService)
            .toConstantValue(await databaseServiceFactory(this.app, this.config().all(), walletRepository, connection));
    }

    public async dispose(): Promise<void> {
        this.app.log.info("Closing Database Connection");

        await this.app
            .get<Contracts.Database.DatabaseService>(Container.Identifiers.DatabaseService)
            .connection.disconnect();
    }

    public async required(): Promise<boolean> {
        return true;
    }
}
