// Every source returns this shape. Extractor and classifier never see source specifics.
export type SourceDocument = {
  url: string;
  title: string | null;
  text: string;
  published_at: string | null; // ISO 8601
  platform: string; // news, reddit, tiktok, youtube, county-minutes, ...
  region_fips: string; // 2-digit state or 5-digit county FIPS
  raw: unknown;
};

// One file per source in this folder, switched on in config/sources.json.
export type Source = {
  name: string;
  fetch(region_fips: string, since?: string): Promise<SourceDocument[]>;
};
