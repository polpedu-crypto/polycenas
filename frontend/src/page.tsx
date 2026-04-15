import TreeMap from "@/components/TreeMap";
import { useState } from "react";
import { dummySuperClusters } from "./utils";
import MultibetsList from "./components/MultibetsList";
import CorrelationHeatmap from "./components/CorrelationHeatmap";

const Page = () => {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  return (
    <main className="w-full max-w-6xl mx-auto flex flex-col gap-2 pt-20">
      <h1 className="font-merriweather font-medium text-6xl">Polycenas</h1>
      <TreeMap
        superClusters={dummySuperClusters}
        currentPath={currentPath}
        onNavigate={setCurrentPath}
        height="600px"
      />
      <section className="grid grid-cols-2 p-1.5 gap-4">
        <MultibetsList />
        <CorrelationHeatmap />
      </section>
    </main>
  );
};

export default Page;
