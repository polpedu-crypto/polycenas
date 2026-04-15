export interface IMarket {
  name: string;
  volume: number;
  currency: string;
  region: string;
  growthRate: number;
}

export interface ICluster {
  name: string;
  description: string;
  markets: IMarket[];
}

export interface ISuperCluster {
  name: string;
  region: string;
  clusters: ICluster[];
}
