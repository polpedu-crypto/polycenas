import TreeMap from "@/components/TreeMap";
import CorrelationHeatmap from "@/components/CorrelationHeatmap";
import { usePolycenas } from "@/provider";

const Page = () => {
  const {
    superClusters,
    selectedCluster,
    currentPath,
    navigate,
    loading,
    clusterLoading,
    error
  } = usePolycenas();

  const showCorrelation = currentPath.length === 2;

  if (loading)
    return (
      <main className="w-full max-w-6xl mx-auto flex flex-col gap-2 pt-20">
        <div className="h-16 w-72 bg-gray-200 animate-pulse " />
        <div className="h-[600px] bg-gray-200 animate-pulse " />
      </main>
    );

  if (error) return <p className="p-8 text-red-500">{error}</p>;

  return (
    <main className="w-full max-w-6xl mx-auto flex flex-col gap-2 pt-20 pb-20">
      <h1 className="font-merriweather font-medium text-6xl">Polycenas</h1>

      <TreeMap
        superClusters={superClusters}
        selectedCluster={selectedCluster}
        clusterLoading={clusterLoading}
        currentPath={currentPath}
        onNavigate={navigate}
        height="600px"
      />

      {showCorrelation && (
        <section className="grid grid-cols-2 gap-8 mt-4 items-start">
          <div>{/* MultibetsList placeholder */}</div>
          <CorrelationHeatmap
            clusterId={selectedCluster?.id ?? null}
            loading={clusterLoading}
          />
        </section>
      )}
    </main>
  );
};

export default Page;
