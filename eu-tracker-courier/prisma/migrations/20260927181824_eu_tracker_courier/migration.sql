-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "windowStartHour" INTEGER NOT NULL DEFAULT 2,
    "windowEndHour" INTEGER NOT NULL DEFAULT 7,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "spreadMinutes" INTEGER NOT NULL DEFAULT 45,
    "prefix" TEXT NOT NULL DEFAULT 'EU',
    "hubCode" TEXT NOT NULL DEFAULT '776017',
    "carrierName" TEXT NOT NULL DEFAULT 'EU Tracker Courier',
    "trackingUrlTemplate" TEXT NOT NULL DEFAULT '',
    "useStorefrontProxy" BOOLEAN NOT NULL DEFAULT true,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "backfillEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxOrdersPerRun" INTEGER NOT NULL DEFAULT 250,
    "minOrderAgeMinutes" INTEGER NOT NULL DEFAULT 0,
    "skipTags" TEXT NOT NULL DEFAULT '',
    "onlyTags" TEXT NOT NULL DEFAULT '',
    "requirePaid" BOOLEAN NOT NULL DEFAULT false,
    "transitDaysMin" INTEGER NOT NULL DEFAULT 2,
    "transitDaysMax" INTEGER NOT NULL DEFAULT 5,
    "skipWeekends" BOOLEAN NOT NULL DEFAULT true,
    "originCity" TEXT NOT NULL DEFAULT 'Madrid, ES',
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderNumber" INTEGER,
    "trackingNumber" TEXT NOT NULL,
    "trackingUrl" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customerName" TEXT,
    "customerEmail" TEXT,
    "destinationCity" TEXT,
    "destinationZip" TEXT,
    "destinationCountry" TEXT,
    "originCity" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" TEXT,
    "currency" TEXT,
    "fulfillmentIds" TEXT NOT NULL DEFAULT '',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "fulfilledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedDeliveryAt" DATETIME,
    "deliveredAt" DATETIME,
    "lastAdvancedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "location" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ordersFound" INTEGER NOT NULL DEFAULT 0,
    "ordersFulfilled" INTEGER NOT NULL DEFAULT 0,
    "ordersFailed" INTEGER NOT NULL DEFAULT 0,
    "ordersSkipped" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "details" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER
);

-- CreateIndex
CREATE INDEX "ShopSettings_automationEnabled_nextRunAt_idx" ON "ShopSettings"("automationEnabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_trackingNumber_key" ON "Shipment"("trackingNumber");

-- CreateIndex
CREATE INDEX "Shipment_shop_fulfilledAt_idx" ON "Shipment"("shop", "fulfilledAt");

-- CreateIndex
CREATE INDEX "Shipment_shop_status_idx" ON "Shipment"("shop", "status");

-- CreateIndex
CREATE INDEX "Shipment_trackingNumber_idx" ON "Shipment"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shop_orderId_key" ON "Shipment"("shop", "orderId");

-- CreateIndex
CREATE INDEX "TrackingEvent_shipmentId_occurredAt_idx" ON "TrackingEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_shipmentId_code_key" ON "TrackingEvent"("shipmentId", "code");

-- CreateIndex
CREATE INDEX "RunLog_shop_startedAt_idx" ON "RunLog"("shop", "startedAt");
