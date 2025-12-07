export interface OrchestrationConfig {
  enabled: boolean;
  clusterName: string;
  nodeId: string;
  peers: string[];
  backend: {
    url: string;
    apiKey: string;
    timeout: number;
  };
  leadership: {
    ttl: number;
  };
}
