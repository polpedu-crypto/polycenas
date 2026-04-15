import type { ISuperCluster } from "./types";

export const dummySuperClusters: ISuperCluster[] = [
  {
    name: "EMEA",
    region: "Europe, Middle East & Africa",
    clusters: [
      {
        name: "Western Europe",
        description: "Mature markets in Western Europe",
        markets: [
          {
            name: "Germany",
            volume: 420,
            currency: "EUR",
            region: "Europe",
            growthRate: 2.1
          },
          {
            name: "France",
            volume: 310,
            currency: "EUR",
            region: "Europe",
            growthRate: 1.8
          },
          {
            name: "Spain",
            volume: 190,
            currency: "EUR",
            region: "Europe",
            growthRate: 2.5
          }
        ]
      },
      {
        name: "Middle East",
        description: "High-growth Gulf markets",
        markets: [
          {
            name: "UAE",
            volume: 280,
            currency: "AED",
            region: "Middle East",
            growthRate: 4.2
          },
          {
            name: "Saudi Arabia",
            volume: 350,
            currency: "SAR",
            region: "Middle East",
            growthRate: 3.8
          }
        ]
      }
    ]
  },
  {
    name: "Americas",
    region: "North & South America",
    clusters: [
      {
        name: "North America",
        description: "US and Canada markets",
        markets: [
          {
            name: "United States",
            volume: 980,
            currency: "USD",
            region: "North America",
            growthRate: 2.9
          },
          {
            name: "Canada",
            volume: 320,
            currency: "CAD",
            region: "North America",
            growthRate: 2.3
          }
        ]
      },
      {
        name: "Latin America",
        description: "Emerging LATAM markets",
        markets: [
          {
            name: "Brazil",
            volume: 410,
            currency: "BRL",
            region: "South America",
            growthRate: 3.5
          },
          {
            name: "Mexico",
            volume: 290,
            currency: "MXN",
            region: "North America",
            growthRate: 3.1
          },
          {
            name: "Argentina",
            volume: 140,
            currency: "ARS",
            region: "South America",
            growthRate: 1.2
          }
        ]
      }
    ]
  },
  {
    name: "APAC",
    region: "Asia Pacific",
    clusters: [
      {
        name: "East Asia",
        description: "Japan, China & Korea",
        markets: [
          {
            name: "China",
            volume: 1200,
            currency: "CNY",
            region: "East Asia",
            growthRate: 5.1
          },
          {
            name: "Japan",
            volume: 560,
            currency: "JPY",
            region: "East Asia",
            growthRate: 1.4
          },
          {
            name: "South Korea",
            volume: 310,
            currency: "KRW",
            region: "East Asia",
            growthRate: 2.7
          }
        ]
      },
      {
        name: "Southeast Asia",
        description: "Fast-growing SEA markets",
        markets: [
          {
            name: "Indonesia",
            volume: 380,
            currency: "IDR",
            region: "SEA",
            growthRate: 5.4
          },
          {
            name: "Vietnam",
            volume: 210,
            currency: "VND",
            region: "SEA",
            growthRate: 6.2
          },
          {
            name: "Thailand",
            volume: 175,
            currency: "THB",
            region: "SEA",
            growthRate: 3.9
          }
        ]
      }
    ]
  }
];
