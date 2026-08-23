// /home/skrisps/lastmile/src/lib/agents/schemas.ts

import { z } from 'zod';
import { AGENT_STATUSES, VEHICLE_TYPES } from './types';

export const updateAgentStatusSchema = z.object({
  status: z.enum(AGENT_STATUSES as unknown as [string, ...string[]], {
    required_error: 'Status is required',
    invalid_type_error: `Status must be one of: ${AGENT_STATUSES.join(', ')}`,
  }),
});

export const setAgentZonesSchema = z.object({
  zoneIds: z
    .array(z.string().min(1, 'Zone ID cannot be empty'), {
      required_error: 'zoneIds array is required',
    })
    .min(0),
});

export const manualAssignSchema = z.object({
  agentId: z.string({
    required_error: 'agentId is required',
  }).min(1, 'agentId cannot be empty'),
});

export const updateAgentProfileSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES as unknown as [string, ...string[]]).optional(),
  vehicleNumber: z.string().max(50).optional(),
  maxCapacity: z.number().int().min(1, 'maxCapacity must be at least 1').max(100).optional(),
});

export const queryAgentsSchema = z.object({
  status: z.enum(AGENT_STATUSES as unknown as [string, ...string[]]).optional(),
  zoneId: z.string().optional(),
  availableOnly: z.enum(['true', 'false']).optional(),
});
