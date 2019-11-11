import { Container, Contracts, Utils as AppUtils } from "@arkecosystem/core-kernel";
import { Identities, Utils } from "@arkecosystem/crypto";

import { WalletIndexAlreadyRegisteredError, WalletIndexNotFoundError } from "./errors";
import { TempWalletRepository } from "./temp-wallet-repository";
import { Wallet } from "./wallet";
import { WalletIndex } from "./wallet-index";

// todo: review the implementation
@Container.injectable()
export class WalletRepository implements Contracts.State.WalletRepository {
    @Container.inject(Container.Identifiers.Application)
    public app!: Contracts.Kernel.Application;

    protected readonly indexes: Record<string, Contracts.State.WalletIndex> = {};

    public init() {
        this.reset();

        this.registerIndex(
            Contracts.State.WalletIndexes.Addresses,
            (index: Contracts.State.WalletIndex, wallet: Contracts.State.Wallet) => {
                if (wallet.address) {
                    index.set(wallet.address, wallet);
                }
            },
        );

        this.registerIndex(
            Contracts.State.WalletIndexes.PublicKeys,
            (index: Contracts.State.WalletIndex, wallet: Contracts.State.Wallet) => {
                if (wallet.publicKey) {
                    index.set(wallet.publicKey, wallet);
                }
            },
        );

        this.registerIndex(
            Contracts.State.WalletIndexes.Usernames,
            (index: Contracts.State.WalletIndex, wallet: Contracts.State.Wallet) => {
                if (wallet.isDelegate()) {
                    index.set(wallet.getAttribute("delegate.username"), wallet);
                }
            },
        );

        this.registerIndex(
            Contracts.State.WalletIndexes.Resignations,
            (index: Contracts.State.WalletIndex, wallet: Contracts.State.Wallet) => {
                if (wallet.isDelegate() && wallet.hasAttribute("delegate.resigned")) {
                    index.set(wallet.getAttribute("delegate.username"), wallet);
                }
            },
        );

        this.registerIndex(
            Contracts.State.WalletIndexes.Locks,
            (index: Contracts.State.WalletIndex, wallet: Contracts.State.Wallet) => {
                if (wallet.hasAttribute("htlc.locks")) {
                    const locks: object = wallet.getAttribute("htlc.locks");

                    for (const lockId of Object.keys(locks)) {
                        index.set(lockId, wallet);
                    }
                }
            },
        );

        return this;
    }

    public registerIndex(name: string, indexer: Contracts.State.WalletIndexer): void {
        if (this.indexes[name]) {
            throw new WalletIndexAlreadyRegisteredError(name);
        }

        this.indexes[name] = new WalletIndex(indexer);
    }

    public unregisterIndex(name: string): void {
        if (!this.indexes[name]) {
            throw new WalletIndexNotFoundError(name);
        }

        delete this.indexes[name];
    }

    public getIndex(name: string): Contracts.State.WalletIndex {
        if (!this.indexes[name]) {
            throw new WalletIndexNotFoundError(name);
        }

        return this.indexes[name];
    }

    public getIndexNames(): string[] {
        return Object.keys(this.indexes);
    }

    public allByAddress(): ReadonlyArray<Contracts.State.Wallet> {
        return this.getIndex(Contracts.State.WalletIndexes.Addresses).values();
    }

    public allByPublicKey(): ReadonlyArray<Contracts.State.Wallet> {
        return this.getIndex(Contracts.State.WalletIndexes.PublicKeys).values();
    }

    public allByUsername(): ReadonlyArray<Contracts.State.Wallet> {
        return this.getIndex(Contracts.State.WalletIndexes.Usernames).values();
    }

    public findById(id: string): Contracts.State.Wallet {
        for (const index of Object.values(this.indexes)) {
            const wallet: Contracts.State.Wallet | undefined = index.get(id);

            if (wallet) {
                return wallet;
            }
        }

        throw new Error(`A wallet with the ID [${id}] does not exist.`);
    }

    public findByAddress(address: string): Contracts.State.Wallet {
        const index: Contracts.State.WalletIndex = this.getIndex(Contracts.State.WalletIndexes.Addresses);

        if (address && !index.has(address)) {
            index.set(address, new Wallet(address, this.app));
        }

        const wallet: Contracts.State.Wallet | undefined = index.get(address);

        AppUtils.assert.defined<Contracts.State.Wallet>(wallet);

        return wallet;
    }

    public findByPublicKey(publicKey: string): Contracts.State.Wallet {
        const index: Contracts.State.WalletIndex = this.getIndex(Contracts.State.WalletIndexes.PublicKeys);

        if (publicKey && !index.has(publicKey)) {
            const wallet: Contracts.State.Wallet = this.findByAddress(Identities.Address.fromPublicKey(publicKey));
            wallet.publicKey = publicKey;

            index.set(publicKey, wallet);
        }

        const wallet: Contracts.State.Wallet | undefined = index.get(publicKey);

        AppUtils.assert.defined<Contracts.State.Wallet>(wallet);

        return wallet;
    }

    public findByUsername(username: string): Contracts.State.Wallet {
        return this.findByIndex(Contracts.State.WalletIndexes.Usernames, username);
    }

    public findByIndex(index: string | string[], key: string): Contracts.State.Wallet {
        if (!Array.isArray(index)) {
            index = [index];
        }

        for (const name of index) {
            const index: Contracts.State.WalletIndex = this.getIndex(name);

            if (index.has(key)) {
                const wallet: Contracts.State.Wallet | undefined = index.get(key);

                AppUtils.assert.defined<Contracts.State.Wallet>(wallet);

                return wallet;
            }
        }

        throw new Error(`A wallet with the ID [${key}] does not exist in the [${index.join(",")}] index.`);
    }

    public has(key: string): boolean {
        for (const walletIndex of Object.values(this.indexes)) {
            if (walletIndex.has(key)) {
                return true;
            }
        }

        return false;
    }

    public hasByAddress(address: string): boolean {
        return this.hasByIndex(Contracts.State.WalletIndexes.Addresses, address);
    }

    public hasByPublicKey(publicKey: string): boolean {
        return this.hasByIndex(Contracts.State.WalletIndexes.PublicKeys, publicKey);
    }

    public hasByUsername(username: string): boolean {
        return this.hasByIndex(Contracts.State.WalletIndexes.Usernames, username);
    }

    public hasByIndex(indexName: string, key: string): boolean {
        return this.getIndex(indexName).has(key);
    }

    public getNonce(publicKey: string): Utils.BigNumber {
        if (this.hasByPublicKey(publicKey)) {
            return this.findByPublicKey(publicKey).nonce;
        }

        return Utils.BigNumber.ZERO;
    }

    public forgetByAddress(address: string): void {
        this.forgetByIndex(Contracts.State.WalletIndexes.Addresses, address);
    }

    public forgetByPublicKey(publicKey: string): void {
        this.forgetByIndex(Contracts.State.WalletIndexes.PublicKeys, publicKey);
    }

    public forgetByUsername(username: string): void {
        this.forgetByIndex(Contracts.State.WalletIndexes.Usernames, username);
    }

    public forgetByIndex(indexName: string, key: string): void {
        this.getIndex(indexName).forget(key);
    }

    public index(wallets: ReadonlyArray<Contracts.State.Wallet>): void {
        for (const wallet of wallets) {
            this.reindex(wallet);
        }
    }

    public reindex(wallet: Contracts.State.Wallet): void {
        for (const walletIndex of Object.values(this.indexes)) {
            walletIndex.index(wallet);
        }
    }

    public clone(): Contracts.State.WalletRepository {
        return this.app
            .resolve<TempWalletRepository>(TempWalletRepository)
            .setup(this)
            .init();
    }

    public reset(): void {
        for (const walletIndex of Object.values(this.indexes)) {
            walletIndex.clear();
        }
    }
}
