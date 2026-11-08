// Every source returns this shape. Extractor and classifier never see source specifics.
export type SourceDocument = {
  url: string;
  title: string | null;
  text: string;
  published_at: string | null; // ISO 8601
  platform: string; // news, web, reddit, tiktok, youtube, county-minutes, ...
  region_fips: string; // 2-digit state or 5-digit county FIPS
  raw: unknown;
};

export type SourceRequest = {
  region_fips: string;
  region_name: string; // "Mobile County, AL" or "Alabama"
  query: string;
  since?: string; // ISO date, inclusive
  until?: string; // ISO date, exclusive (backtest cutoff: only evidence before the decision)
  limit: number;
};

// One file per source in this folder, switched on in config/sources.json.
export type Source = {
  name: string;
  platform: string;
  env: string[]; // required env vars; the registry skips the source when one is missing
  fetch(req: SourceRequest): Promise<SourceDocument[]>;
};
