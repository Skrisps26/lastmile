import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { NextRequest } from 'next/server';

describe('Empirical Verification: Prisma Schema, Relations, Cascades & Singleton', () => {
  // Test isolation prefix
  const testPrefix = `test_${Date.now()}`;

  afterAll(async () => {
    // Clean up test entities created with testPrefix
    await prisma.notificationLog.deleteMany({
      where: { recipientEmail: { contains: testPrefix } },
    });
    await prisma.orderStatusHistory.deleteMany({
      where: { notes: { contains: testPrefix } },
    });
    await prisma.order.deleteMany({
      where: { trackingNumber: { contains: testPrefix } },
    });
    await prisma.pincodeMapping.deleteMany({
      where: { areaName: { contains: testPrefix } },
    });
    await prisma.zone.deleteMany({
      where: { code: { contains: testPrefix } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: testPrefix } },
    });
  });

  describe('1. Demo User Password & Authentication Verification', () => {
    const demoAccounts = [
      { email: 'admin@lastmile.local', expectedRole: 'ADMIN', name: 'System Administrator' },
      { email: 'agent1@lastmile.local', expectedRole: 'AGENT', name: 'Rajesh Kumar' },
      { email: 'agent2@lastmile.local', expectedRole: 'AGENT', name: 'Priya Sharma' },
      { email: 'customer@lastmile.local', expectedRole: 'CUSTOMER', name: 'Aarav Mehta' },
      { email: 'b2b@lastmile.local', expectedRole: 'CUSTOMER', name: 'Apex Retail Enterprises' },
    ];

    it.each(demoAccounts)(
      'should authenticate demo account $email with Password123!',
      async ({ email, expectedRole, name }) => {
        const user = await prisma.user.findUnique({
          where: { email },
        });

        expect(user).toBeDefined();
        expect(user?.email).toBe(email);
        expect(user?.role).toBe(expectedRole);
        expect(user?.name).toBe(name);

        // Verify password hash against 'Password123!'
        const isMatch = await verifyPassword('Password123!', user!.passwordHash);
        expect(isMatch).toBe(true);

        // Verify that wrong password fails
        const isWrongMatch = await verifyPassword('WrongPassword123!', user!.passwordHash);
        expect(isWrongMatch).toBe(false);

        // Verify direct login route API authentication
        const loginReq = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password: 'Password123!',
          }),
        });

        const res = await loginHandler(loginReq);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.message).toBe('Login successful');
        expect(body.user.email).toBe(email);
        expect(body.user.role).toBe(expectedRole);
        expect(body.token).toBeDefined();
      }
    );
  });

  describe('2. Seed Data Completeness & Relational Integrity', () => {
    it('should have all 4 operational zones seeded with valid codes', async () => {
      const zones = await prisma.zone.findMany({
        where: {
          code: { in: ['ZONE_NORTH', 'ZONE_SOUTH', 'ZONE_WEST', 'ZONE_EAST'] },
        },
      });

      expect(zones.length).toBe(4);
      const codes = zones.map((z) => z.code);
      expect(codes).toContain('ZONE_NORTH');
      expect(codes).toContain('ZONE_SOUTH');
      expect(codes).toContain('ZONE_WEST');
      expect(codes).toContain('ZONE_EAST');
    });

    it('should have 16 pincode mappings distributed across the 4 zones', async () => {
      const pincodes = await prisma.pincodeMapping.findMany({
        include: { zone: true },
      });

      expect(pincodes.length).toBeGreaterThanOrEqual(16);
      for (const p of pincodes) {
        expect(p.pincode).toMatch(/^\d{6}$/);
        expect(p.zone).toBeDefined();
        expect(p.zoneId).toBe(p.zone.id);
      }
    });

    it('should have all 4 rate cards (INTRA/INTER x B2C/B2B) active and configured', async () => {
      const rateCards = await prisma.rateCard.findMany({
        where: { isActive: true },
      });

      const combinations = rateCards.map((rc) => `${rc.zoneType}_${rc.customerType}`);
      expect(combinations).toContain('INTRA_ZONE_B2C');
      expect(combinations).toContain('INTRA_ZONE_B2B');
      expect(combinations).toContain('INTER_ZONE_B2C');
      expect(combinations).toContain('INTER_ZONE_B2B');

      for (const rc of rateCards) {
        expect(rc.baseRate).toBeGreaterThan(0);
        expect(rc.perKgRate).toBeGreaterThan(0);
        expect(rc.volumetricDivisor).toBe(5000);
      }
    });

    it('should have demo agents linked to their operational zones', async () => {
      const demoAgents = await prisma.user.findMany({
        where: {
          email: { in: ['agent1@lastmile.local', 'agent2@lastmile.local'] },
        },
        include: {
          agentProfile: {
            include: {
              operationalZones: { include: { zone: true } },
            },
          },
        },
      });

      expect(demoAgents.length).toBe(2);
      for (const agent of demoAgents) {
        expect(agent.agentProfile).toBeDefined();
        expect(agent.agentProfile?.operationalZones.length).toBeGreaterThanOrEqual(2);
        expect(agent.agentProfile?.status).toBe('AVAILABLE');
        for (const oz of agent.agentProfile!.operationalZones) {
          expect(oz.zone).toBeDefined();
          expect(oz.zone.name).toBeDefined();
        }
      }
    });

    it('should have address book seeded for demo customer accounts', async () => {
      const customer = await prisma.user.findUnique({
        where: { email: 'customer@lastmile.local' },
        include: { addresses: true },
      });
      expect(customer?.addresses.length).toBeGreaterThanOrEqual(2);

      const b2b = await prisma.user.findUnique({
        where: { email: 'b2b@lastmile.local' },
        include: { addresses: true },
      });
      expect(b2b?.addresses.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Unique Constraint Enforcement', () => {
    it('should enforce unique constraint on User.email', async () => {
      const email = `${testPrefix}_dup_user@lastmile.local`;
      await prisma.user.create({
        data: {
          email,
          name: 'First User',
          passwordHash: await hashPassword('Password123!'),
          role: 'CUSTOMER',
        },
      });

      // Second insert with exact duplicate email must fail
      await expect(
        prisma.user.create({
          data: {
            email,
            name: 'Second User',
            passwordHash: await hashPassword('Password123!'),
            role: 'CUSTOMER',
          },
        })
      ).rejects.toThrow();
    });

    it('should enforce unique constraint on Zone.code and Zone.name', async () => {
      const zoneName = `${testPrefix} Test Zone`;
      const zoneCode = `${testPrefix}_ZONE`;

      const zone = await prisma.zone.create({
        data: {
          name: zoneName,
          code: zoneCode,
        },
      });

      // Duplicate code
      await expect(
        prisma.zone.create({
          data: {
            name: `${testPrefix} Another Zone`,
            code: zoneCode,
          },
        })
      ).rejects.toThrow();

      // Duplicate name
      await expect(
        prisma.zone.create({
          data: {
            name: zoneName,
            code: `${testPrefix}_ZONE_2`,
          },
        })
      ).rejects.toThrow();

      await prisma.zone.delete({ where: { id: zone.id } });
    });

    it('should enforce unique constraint on PincodeMapping.pincode', async () => {
      const testZone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Pin Zone`,
          code: `${testPrefix}_PIN_ZONE`,
        },
      });

      const pincode = '999001';
      await prisma.pincodeMapping.create({
        data: {
          pincode,
          areaName: `${testPrefix} Area 1`,
          zoneId: testZone.id,
        },
      });

      // Duplicate pincode
      await expect(
        prisma.pincodeMapping.create({
          data: {
            pincode,
            areaName: `${testPrefix} Area 2`,
            zoneId: testZone.id,
          },
        })
      ).rejects.toThrow();

      await prisma.zone.delete({ where: { id: testZone.id } });
    });

    it('should enforce unique constraint on DeliveryAgentProfile.userId (1:1 relation)', async () => {
      const agentUser = await prisma.user.create({
        data: {
          email: `${testPrefix}_agent_1to1@lastmile.local`,
          name: '1:1 Agent',
          passwordHash: await hashPassword('Password123!'),
          role: 'AGENT',
        },
      });

      await prisma.deliveryAgentProfile.create({
        data: {
          userId: agentUser.id,
          vehicleType: 'BIKE',
        },
      });

      // Attempting to create second profile for same userId must fail
      await expect(
        prisma.deliveryAgentProfile.create({
          data: {
            userId: agentUser.id,
            vehicleType: 'VAN',
          },
        })
      ).rejects.toThrow();

      await prisma.user.delete({ where: { id: agentUser.id } });
    });

    it('should enforce composite unique constraint on AgentZoneMapping (agentId, zoneId)', async () => {
      const agentUser = await prisma.user.create({
        data: {
          email: `${testPrefix}_agent_dup_zone@lastmile.local`,
          name: 'Dup Zone Agent',
          passwordHash: await hashPassword('Password123!'),
          role: 'AGENT',
        },
      });

      const profile = await prisma.deliveryAgentProfile.create({
        data: {
          userId: agentUser.id,
        },
      });

      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Unique Mapping Zone`,
          code: `${testPrefix}_MAP_ZONE`,
        },
      });

      await prisma.agentZoneMapping.create({
        data: {
          agentId: profile.id,
          zoneId: zone.id,
        },
      });

      // Attempting to link same agent to same zone twice must fail
      await expect(
        prisma.agentZoneMapping.create({
          data: {
            agentId: profile.id,
            zoneId: zone.id,
          },
        })
      ).rejects.toThrow();

      await prisma.user.delete({ where: { id: agentUser.id } });
      await prisma.zone.delete({ where: { id: zone.id } });
    });

    it('should enforce unique constraint on Order.trackingNumber', async () => {
      const customer = await prisma.user.create({
        data: {
          email: `${testPrefix}_order_cust@lastmile.local`,
          name: 'Order Customer',
          passwordHash: await hashPassword('Password123!'),
          role: 'CUSTOMER',
        },
      });

      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Order Zone`,
          code: `${testPrefix}_ORD_ZONE`,
        },
      });

      const trackingNumber = `LMD-${testPrefix}-001`;

      const orderData = {
        trackingNumber,
        customerId: customer.id,
        customerType: 'B2C',
        senderName: 'Sender',
        senderPhone: '+91-9876543210',
        senderStreet: 'Street 1',
        senderCity: 'City',
        senderState: 'State',
        pickupPincode: '560001',
        pickupZoneId: zone.id,
        recipientName: 'Recipient',
        recipientPhone: '+91-9876543211',
        recipientStreet: 'Street 2',
        recipientCity: 'City',
        recipientState: 'State',
        dropPincode: '560001',
        dropZoneId: zone.id,
        packageLengthCm: 10,
        packageBreadthCm: 10,
        packageHeightCm: 10,
        actualWeightKg: 1,
        volumetricWeightKg: 0.2,
        billableWeightKg: 1,
        volumetricDivisor: 5000,
        zoneType: 'INTRA_ZONE',
        basePrice: 40,
        weightPrice: 0,
        codSurcharge: 0,
        totalAmount: 40,
      };

      await prisma.order.create({ data: orderData });

      // Creating second order with identical trackingNumber must fail
      await expect(
        prisma.order.create({
          data: {
            ...orderData,
          },
        })
      ).rejects.toThrow();

      await prisma.order.delete({ where: { trackingNumber } });
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.zone.delete({ where: { id: zone.id } });
    });
  });

  describe('4. Cascade Delete Behaviors & Referential Actions', () => {
    it('should cascade delete Address records when User is deleted', async () => {
      const user = await prisma.user.create({
        data: {
          email: `${testPrefix}_cascade_user@lastmile.local`,
          name: 'Cascade User',
          passwordHash: await hashPassword('Password123!'),
          addresses: {
            create: [
              {
                street: '123 Test St',
                city: 'Test City',
                state: 'Test State',
                pincode: '560001',
                contactPhone: '+91-9876543210',
              },
              {
                street: '456 Test Ave',
                city: 'Test City',
                state: 'Test State',
                pincode: '560002',
                contactPhone: '+91-9876543210',
              },
            ],
          },
        },
        include: { addresses: true },
      });

      expect(user.addresses.length).toBe(2);
      const addressIds = user.addresses.map((a) => a.id);

      // Delete user
      await prisma.user.delete({ where: { id: user.id } });

      // Addresses should be deleted via cascade
      const remainingAddresses = await prisma.address.findMany({
        where: { id: { in: addressIds } },
      });
      expect(remainingAddresses.length).toBe(0);
    });

    it('should cascade delete DeliveryAgentProfile and AgentZoneMapping when Agent User is deleted', async () => {
      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Cascade Zone`,
          code: `${testPrefix}_CASC_ZONE`,
        },
      });

      const agentUser = await prisma.user.create({
        data: {
          email: `${testPrefix}_cascade_agent@lastmile.local`,
          name: 'Cascade Agent',
          passwordHash: await hashPassword('Password123!'),
          role: 'AGENT',
        },
      });

      const profile = await prisma.deliveryAgentProfile.create({
        data: {
          userId: agentUser.id,
          vehicleType: 'VAN',
        },
      });

      const mapping = await prisma.agentZoneMapping.create({
        data: {
          agentId: profile.id,
          zoneId: zone.id,
        },
      });

      // Delete agent user
      await prisma.user.delete({ where: { id: agentUser.id } });

      // DeliveryAgentProfile should be cascade deleted
      const foundProfile = await prisma.deliveryAgentProfile.findUnique({
        where: { id: profile.id },
      });
      expect(foundProfile).toBeNull();

      // AgentZoneMapping should be cascade deleted
      const foundMapping = await prisma.agentZoneMapping.findUnique({
        where: { id: mapping.id },
      });
      expect(foundMapping).toBeNull();

      await prisma.zone.delete({ where: { id: zone.id } });
    });

    it('should cascade delete PincodeMappings when Zone is deleted', async () => {
      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Cascade Zone 2`,
          code: `${testPrefix}_CASC_ZONE_2`,
          pincodes: {
            create: [
              { pincode: '998001', areaName: `${testPrefix} P1` },
              { pincode: '998002', areaName: `${testPrefix} P2` },
            ],
          },
        },
        include: { pincodes: true },
      });

      expect(zone.pincodes.length).toBe(2);
      const pinIds = zone.pincodes.map((p) => p.id);

      // Delete zone
      await prisma.zone.delete({ where: { id: zone.id } });

      // Pincode mappings must be cascade deleted
      const remainingPins = await prisma.pincodeMapping.findMany({
        where: { id: { in: pinIds } },
      });
      expect(remainingPins.length).toBe(0);
    });

    it('should cascade delete OrderStatusHistory and NotificationLog when Order is deleted', async () => {
      const customer = await prisma.user.create({
        data: {
          email: `${testPrefix}_order_cascade_cust@lastmile.local`,
          name: 'Order Cascade Customer',
          passwordHash: await hashPassword('Password123!'),
          role: 'CUSTOMER',
        },
      });

      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Order Casc Zone`,
          code: `${testPrefix}_ORD_CASC_ZONE`,
        },
      });

      const order = await prisma.order.create({
        data: {
          trackingNumber: `LMD-${testPrefix}-CASC-001`,
          customerId: customer.id,
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: 'Street',
          senderCity: 'City',
          senderState: 'State',
          pickupPincode: '560001',
          pickupZoneId: zone.id,
          recipientName: 'Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: 'Street',
          recipientCity: 'City',
          recipientState: 'State',
          dropPincode: '560001',
          dropZoneId: zone.id,
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1,
          volumetricWeightKg: 0.2,
          billableWeightKg: 1,
          zoneType: 'INTRA_ZONE',
          basePrice: 40,
          weightPrice: 0,
          totalAmount: 40,
          statusHistory: {
            create: [
              { status: 'CREATED', notes: `${testPrefix} initial creation` },
              { status: 'ASSIGNED', notes: `${testPrefix} assigned to driver` },
            ],
          },
          notifications: {
            create: [
              {
                recipientEmail: `${testPrefix}_cust@lastmile.local`,
                event: 'STATUS_CREATED',
                subject: 'Order Created',
                provider: 'MOCK_LOGGER',
                status: 'SENT',
              },
            ],
          },
        },
        include: {
          statusHistory: true,
          notifications: true,
        },
      });

      expect(order.statusHistory.length).toBe(2);
      expect(order.notifications.length).toBe(1);

      const historyIds = order.statusHistory.map((h) => h.id);
      const notificationIds = order.notifications.map((n) => n.id);

      // Delete Order
      await prisma.order.delete({ where: { id: order.id } });

      // Verify cascaded deletion of statusHistory and notifications
      const remainingHistory = await prisma.orderStatusHistory.findMany({
        where: { id: { in: historyIds } },
      });
      expect(remainingHistory.length).toBe(0);

      const remainingNotifications = await prisma.notificationLog.findMany({
        where: { id: { in: notificationIds } },
      });
      expect(remainingNotifications.length).toBe(0);

      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.zone.delete({ where: { id: zone.id } });
    });

    it('should set null on Order.assignedAgentId when Agent Profile is deleted (onDelete: SetNull)', async () => {
      const customer = await prisma.user.create({
        data: {
          email: `${testPrefix}_agent_null_cust@lastmile.local`,
          name: 'Cust',
          passwordHash: await hashPassword('Password123!'),
        },
      });

      const agentUser = await prisma.user.create({
        data: {
          email: `${testPrefix}_agent_null_driver@lastmile.local`,
          name: 'Driver',
          passwordHash: await hashPassword('Password123!'),
          role: 'AGENT',
        },
      });

      const profile = await prisma.deliveryAgentProfile.create({
        data: {
          userId: agentUser.id,
        },
      });

      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} SetNull Zone`,
          code: `${testPrefix}_SETNULL_ZONE`,
        },
      });

      const order = await prisma.order.create({
        data: {
          trackingNumber: `LMD-${testPrefix}-NULL-001`,
          customerId: customer.id,
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: 'Street',
          senderCity: 'City',
          senderState: 'State',
          pickupPincode: '560001',
          pickupZoneId: zone.id,
          recipientName: 'Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: 'Street',
          recipientCity: 'City',
          recipientState: 'State',
          dropPincode: '560001',
          dropZoneId: zone.id,
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1,
          volumetricWeightKg: 0.2,
          billableWeightKg: 1,
          zoneType: 'INTRA_ZONE',
          basePrice: 40,
          weightPrice: 0,
          totalAmount: 40,
          assignedAgentId: profile.id,
        },
      });

      expect(order.assignedAgentId).toBe(profile.id);

      // Delete agent profile
      await prisma.deliveryAgentProfile.delete({ where: { id: profile.id } });

      // Refresh order: assignedAgentId should be null
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(updatedOrder?.assignedAgentId).toBeNull();

      // Clean up
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.user.delete({ where: { id: agentUser.id } });
      await prisma.zone.delete({ where: { id: zone.id } });
    });

    it('should set null on OrderStatusHistory.changedById when User is deleted (onDelete: SetNull)', async () => {
      const authorUser = await prisma.user.create({
        data: {
          email: `${testPrefix}_author@lastmile.local`,
          name: 'Author User',
          passwordHash: await hashPassword('Password123!'),
        },
      });

      const customer = await prisma.user.create({
        data: {
          email: `${testPrefix}_author_cust@lastmile.local`,
          name: 'Customer',
          passwordHash: await hashPassword('Password123!'),
        },
      });

      const zone = await prisma.zone.create({
        data: {
          name: `${testPrefix} Author Zone`,
          code: `${testPrefix}_AUTH_ZONE`,
        },
      });

      const order = await prisma.order.create({
        data: {
          trackingNumber: `LMD-${testPrefix}-AUTH-001`,
          customerId: customer.id,
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: 'Street',
          senderCity: 'City',
          senderState: 'State',
          pickupPincode: '560001',
          pickupZoneId: zone.id,
          recipientName: 'Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: 'Street',
          recipientCity: 'City',
          recipientState: 'State',
          dropPincode: '560001',
          dropZoneId: zone.id,
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1,
          volumetricWeightKg: 0.2,
          billableWeightKg: 1,
          zoneType: 'INTRA_ZONE',
          basePrice: 40,
          weightPrice: 0,
          totalAmount: 40,
          statusHistory: {
            create: {
              status: 'CREATED',
              changedById: authorUser.id,
              notes: `${testPrefix} created by authorUser`,
            },
          },
        },
        include: { statusHistory: true },
      });

      const historyId = order.statusHistory[0].id;
      expect(order.statusHistory[0].changedById).toBe(authorUser.id);

      // Delete authorUser
      await prisma.user.delete({ where: { id: authorUser.id } });

      // Refresh history record: changedById should be set to null
      const updatedHistory = await prisma.orderStatusHistory.findUnique({
        where: { id: historyId },
      });
      expect(updatedHistory?.changedById).toBeNull();

      // Clean up
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: customer.id } });
      await prisma.zone.delete({ where: { id: zone.id } });
    });
  });

  describe('5. Database Singleton & Connection Leak Verification', () => {
    it('should maintain a single global instance across multiple imports', async () => {
      const { prisma: prisma1 } = await import('@/lib/prisma');
      const { prisma: prisma2 } = await import('@/lib/prisma');
      const { default: prismaDefault } = await import('@/lib/prisma');

      expect(prisma1).toBe(prisma2);
      expect(prisma1).toBe(prismaDefault);
      expect(prisma1).toBe(prisma);
    });

    it('should handle 100 concurrent async queries without connection leak or failure', async () => {
      const queryPromises = Array.from({ length: 100 }, async (_, index) => {
        const zones = await prisma.zone.findMany({
          take: 2,
          select: { id: true, code: true },
        });
        return { index, count: zones.length };
      });

      const results = await Promise.all(queryPromises);
      expect(results.length).toBe(100);
      for (const res of results) {
        expect(res.count).toBeGreaterThan(0);
      }
    });

    it('should handle sequential high-throughput queries cleanly', async () => {
      const iterations = 50;
      for (let i = 0; i < iterations; i++) {
        const userCount = await prisma.user.count();
        expect(userCount).toBeGreaterThan(0);
      }
    });

    it('should survive connection disconnect and transparently reconnect on subsequent query', async () => {
      // Explicitly disconnect
      await prisma.$disconnect();

      // Query again - PrismaClient should automatically re-establish connection
      const count = await prisma.zone.count();
      expect(count).toBeGreaterThan(0);
    });
  });
});
