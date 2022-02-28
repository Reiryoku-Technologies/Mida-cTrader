import {
    GenericObject,
    MidaBrokerPosition,
    MidaBrokerPositionProtection,
    MidaBrokerPositionStatus,
} from "@reiryoku/mida";
import { CTraderBrokerPositionParameters } from "#brokers/ctrader/positions/CTraderBrokerPositionParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerPosition extends MidaBrokerPosition {
    readonly #connection: CTraderConnection;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;

    public constructor ({
        id,
        orders,
        protection,
        connection,
    }: CTraderBrokerPositionParameters) {
        super({
            id,
            orders,
            protection,
        });

        this.#connection = connection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;

        this.#configureListeners();
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let usedMargin: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                usedMargin += Number(plainOpenPosition.usedMargin);
            }
        }

        return usedMargin / 100;
    }

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let swap: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                swap += Number(plainOpenPosition.swap);
            }
        }

        return swap / 100;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let commission: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                commission += Number(plainOpenPosition.commission);
            }
        }

        return commission / 100;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let unrealizedGrossProfit: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                unrealizedGrossProfit += await this.#cTraderBrokerAccount.getPlainPositionGrossProfit(plainOpenPosition);
            }
        }

        return unrealizedGrossProfit / 100;
    }

    public override async modifyProtection (protection: MidaBrokerPositionProtection): Promise<void> {
        await this.#connection.sendCommand("ProtoOAAmendPositionSLTPReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            positionId: this.id,
            stopLoss: protection.stopLoss ?? this.protection.stopLoss,
            takeProfit: protection.takeProfit ?? this.protection.takeProfit,
            trailingStopLoss: protection.trailingStopLoss ?? this.protection.trailingStopLoss === true,
        });
    }

    public override async setStopLoss (stopLoss: number): Promise<void> {
        await this.modifyProtection({ stopLoss, });
    }

    public override async setTakeProfit (takeProfit: number): Promise<void> {
        await this.modifyProtection({ takeProfit, });
    }

    public override async setTrailingStopLoss (trailingStopLoss:boolean): Promise<void> {
        await this.modifyProtection({ trailingStopLoss, });
    }

    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        switch (descriptor.executionType) {
            case "SWAP": {
                this.onSwap(NaN);

                break;
            }

            /* case "ORDER_ACCEPTED": */
            case "ORDER_FILLED":
            /* case "ORDER_CANCELLED":
            case "ORDER_EXPIRED":
            case "ORDER_REJECTED":
            case "ORDER_PARTIAL_FILL": */ {
                const plainOrder: GenericObject = descriptor.order;
                const positionId: string = plainOrder?.positionId?.toString();

                if (positionId === this.id) {
                    this.onOrderFill(await this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder));
                }

                break;
            }
        }

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor).then(() => undefined); // then() is used just to avoid annoying editors warning
        }
    }

    #configureListeners (): void {
        this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onUpdate(descriptor).then(() => undefined); // then() is used just to avoid annoying editors warning
            }
        });
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}
