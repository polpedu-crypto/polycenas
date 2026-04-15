import TreeMap from "@/components/TreeMap";
import { useState } from "react";
import { dummySuperClusters } from "./utils";

const Page = () => {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  return (
    <main className="w-full max-w-6xl mx-auto flex flex-col pt-20">
      <h1 className="font-merriweather font-medium text-6xl">Polycenas</h1>
      <TreeMap
        superClusters={dummySuperClusters}
        currentPath={currentPath}
        onNavigate={setCurrentPath}
        height="600px"
      />
    </main>
  );
};

export default Page;
