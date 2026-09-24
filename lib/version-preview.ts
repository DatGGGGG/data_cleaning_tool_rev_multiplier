export type LocalVersionPreview = {
  title: string;
  workflow: "top_down" | "bottom_up";
  version: {
    id: string;
    label: string;
    createdAt: string;
    createdBy: string;
    rowCount: number;
    checksumSha256: string;
    summary: string;
  };
  columns: string[];
  rows: string[][];
};
