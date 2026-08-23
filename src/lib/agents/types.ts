// /home/skrisps/lastmile/src/lib/agents/types.ts

export type AgentStatus = 'AVAILABLE' | 'OFFLINE' | 'ON_DELIVERY';

export const AGENT_STATUSES: readonly AgentStatus[] = ['AVAILABLE', 'OFFLINE', 'ON_DELIVERY'] as const;

export type VehicleType = 'BIKE' | 'VAN' | 'TRUCK';

export const VEHICLE_TYPES: readonly VehicleType[] = ['BIKE', 'VAN', 'TRUCK'] as const;

export interface AgentZoneInfo {
  id: string;
  agentId: string;
  zoneId: string;
  createdAt: Date;
  zone: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isActive: boolean;
  };
}

export interface AgentProfileSummary {
  id: string;
  userId: string;
  status: AgentStatus;
  vehicleType: string | null;
  vehicleNumber: string | null;
  maxCapacity: number;
  activeOrdersCount: number;
  availableCapacity: number;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
  };
  operationalZones: AgentZoneInfo[];
}

export interface AutoAssignResult {
  success: boolean;
  reason?: string;
  assignedAgent?: {
    id: string;
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    status: AgentStatus;
    activeOrdersCount: number;
    maxCapacity: number;
    matchedZoneId?: string;
  };
  order?: {
    id: string;
    trackingNumber: string;
    assignedAgentId: string | null;
    currentStatus: string;
  };
}

export interface BatchAutoAssignResult {
  totalChecked: number;
  assignedCount: number;
  unassignedCount: number;
  results: Array<{
    orderId: string;
    trackingNumber: string;
    success: boolean;
    agentId?: string;
    agentName?: string;
    reason?: string;
  }>;
}

export interface ManualAssignResult {
  success: boolean;
  order: any;
  assignedAgent: {
    id: string;
    userId: string;
    name: string;
    email: string;
    phone: string | null;
    activeOrdersCount: number;
    maxCapacity: number;
  };
}

export interface ReleaseAgentResult {
  success: boolean;
  agentId: string;
  activeOrdersCount: number;
  status: AgentStatus;
}
