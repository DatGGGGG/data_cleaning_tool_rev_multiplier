import type { PublisherRowDraft, PublisherSeed, PublisherSheet } from "@/lib/top-down/types";
import { createEmptyRow, createPlatformEntry } from "@/lib/top-down/workbench";

function createPublisherRows(
  rows: Array<{
    gameName: string;
    sensorTowerLink: string;
    iosAppId?: string;
    iosStoreAccount?: string;
    androidAppId?: string;
    androidStoreAccount?: string;
    reviewStatus?: "needs_review" | "confirmed" | "seeded";
    notes?: string;
  }>,
): PublisherRowDraft[] {
  return rows.map((row, index) => ({
    ...createEmptyRow(index + 1),
    gameName: row.gameName,
    sensorTowerLink: row.sensorTowerLink,
    iosApps: row.iosAppId ? [createPlatformEntry(row.iosAppId, row.iosStoreAccount ?? "", "", "manual")] : [],
    androidApps: row.androidAppId
      ? [createPlatformEntry(row.androidAppId, row.androidStoreAccount ?? "", "", "manual")]
      : [],
    reviewStatus: row.reviewStatus ?? "confirmed",
    notes: row.notes ?? "",
  }));
}

export function createSeedPublishers(): PublisherSheet[] {
  return [
    {
      id: "seed_cmnonline",
      key: "cmnonline",
      name: "CMNOnline",
      revenueMultiplier: "1",
      rows: createPublisherRows([
        {
          gameName: "Van Tien Tran",
          sensorTowerLink:
            "https://app.sensortower.com/overview/6333ddb2c0eb7a1af4122b15/vn.cmn.thoikhongtrieuhoan?country=VN",
          iosAppId: "1636845725",
          iosStoreAccount: "CMNOnline",
          androidAppId: "vn.cmn.thoikhongtrieuhoan",
          androidStoreAccount: "CMN Mobile Game",
          reviewStatus: "confirmed",
        },
        {
          gameName: "Ve Than Arena - Dau Tuong AFK",
          sensorTowerLink:
            "https://app.sensortower.com/overview/6275da90a55dd41d59a7a185/vn.cmn.vethanarena?country=US",
          iosAppId: "1619448506",
          iosStoreAccount: "CMNOnline",
          androidAppId: "vn.cmn.vethanarena",
          androidStoreAccount: "CMN Mobile Game",
          reviewStatus: "confirmed",
        },
        {
          gameName: "Hero Max",
          sensorTowerLink:
            "https://app.sensortower.com/overview/644b22f857ff1e62fb197290/vn.cmn.heromax?country=VN",
          iosAppId: "6447054614",
          iosStoreAccount: "CMNOnline",
          androidAppId: "vn.cmn.heromax",
          androidStoreAccount: "CMNOnline",
          reviewStatus: "needs_review",
          notes: "Android publisher account naming should be confirmed against website.",
        },
      ]),
    },
    {
      id: "seed_garena",
      key: "garena",
      name: "Garena",
      revenueMultiplier: "1",
      rows: createPublisherRows([
        {
          gameName: "Lien Quan Mobile",
          sensorTowerLink:
            "https://app.sensortower.com/overview/1150288115/com.garena.game.kgvn?country=VN",
          iosAppId: "1150288115",
          iosStoreAccount: "Garena Online",
          androidAppId: "com.garena.game.kgvn",
          androidStoreAccount: "Garena Mobile Private",
          reviewStatus: "confirmed",
        },
        {
          gameName: "Free Fire",
          sensorTowerLink:
            "https://app.sensortower.com/overview/1300146617/com.dts.freefireth?country=VN",
          iosAppId: "1300146617",
          iosStoreAccount: "GARENA INTERNATIONAL I PRIVATE LIMITED",
          androidAppId: "com.dts.freefireth",
          androidStoreAccount: "GARENA INTERNATIONAL I PRIVATE LIMITED",
          reviewStatus: "confirmed",
        },
      ]),
    },
    {
      id: "seed_vng",
      key: "vng",
      name: "VNG",
      revenueMultiplier: "1",
      rows: createPublisherRows([
        {
          gameName: "Vo Lam Truyen Ky MAX",
          sensorTowerLink:
            "https://app.sensortower.com/overview/6471853075/com.vng.vltkmax?country=VN",
          iosAppId: "6471853075",
          iosStoreAccount: "VNG SINGAPORE PTE LTD",
          androidAppId: "com.vng.vltkmax",
          androidStoreAccount: "VNG Corporation",
          reviewStatus: "seeded",
          notes: "Seeded from imported publisher app list.",
        },
      ]),
    },
  ];
}

export function createPublisherSeeds(): PublisherSeed[] {
  return createSeedPublishers().map((publisher, index) => ({
    key: publisher.key,
    name: publisher.name,
    revenueMultiplier: publisher.revenueMultiplier,
    sortOrder: index,
    rows: publisher.rows,
  }));
}
