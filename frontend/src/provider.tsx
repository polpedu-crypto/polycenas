import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from "react";
import { getCluster, getSuperClusters } from "@/utils/api";
import type { ICluster, ISuperCluster } from "@/types";

interface IPolycenasContext {
  superClusters: ISuperCluster[];
  selectedCluster: ICluster | null;
  currentPath: string[];
  loading: boolean;
  clusterLoading: boolean;
  error: string | null;
  navigate: (path: string[]) => void;
}

const PolycenasContext = createContext<IPolycenasContext | null>(null);

export const PolycenasProvider = ({
  children
}: {
  children: React.ReactNode;
}) => {
  const [superClusters, setSuperClusters] = useState<ISuperCluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<ICluster | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all superclusters on mount
  useEffect(() => {
    setLoading(true);
    getSuperClusters()
      .then(setSuperClusters)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const navigate = useCallback(
    async (path: string[]) => {
      setCurrentPath(path);

      // Going back — clear selected cluster
      if (path.length < 2) {
        setSelectedCluster(null);
        return;
      }

      // Entering a cluster — fetch its markets
      const [scName, clName] = path;
      const sc = superClusters.find((s) => s.name === scName);
      const cl = sc?.clusters.find((c) => c.name === clName);
      if (!cl) return;

      setClusterLoading(true);
      try {
        const full = await getCluster(cl.id);
        setSelectedCluster(full);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setClusterLoading(false);
      }
    },
    [superClusters]
  );

  return (
    <PolycenasContext.Provider
      value={{
        superClusters,
        selectedCluster,
        currentPath,
        loading,
        clusterLoading,
        error,
        navigate
      }}
    >
      {children}
    </PolycenasContext.Provider>
  );
};

export const usePolycenas = (): IPolycenasContext => {
  const ctx = useContext(PolycenasContext);
  if (!ctx)
    throw new Error("usePolycenas must be used inside PolycenasProvider");
  return ctx;
};
