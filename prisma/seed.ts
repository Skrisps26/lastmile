// /home/skrisps/lastmile/prisma/seed.ts

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  const defaultPassword = 'Password123!';
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(defaultPassword, saltRounds);

  // ==========================================
  // 1. Seed Geographic Zones
  // ==========================================
  console.log('📍 Seeding default zones...');
  
  const zonesData = [
    {
      code: 'ZONE_NORTH',
      name: 'North Metro',
      description: 'Northern metropolitan tech corridor, GPO, and airport expressway districts',
      isActive: true,
    },
    {
      code: 'ZONE_SOUTH',
      name: 'South Suburban',
      description: 'Southern residential and high-density suburban communities',
      isActive: true,
    },
    {
      code: 'ZONE_WEST',
      name: 'West Central',
      description: 'Western commercial markets, business districts, and transit exchanges',
      isActive: true,
    },
    {
      code: 'ZONE_EAST',
      name: 'East Industrial',
      description: 'Eastern manufacturing parks, export zones, and logistics warehouses',
      isActive: true,
    },
  ];

  const zoneMap: Record<string, string> = {};

  for (const zone of zonesData) {
    const createdZone = await prisma.zone.upsert({
      where: { code: zone.code },
      update: {
        name: zone.name,
        description: zone.description,
        isActive: zone.isActive,
      },
      create: zone,
    });
    zoneMap[zone.code] = createdZone.id;
    console.log(`   ✓ Zone: ${zone.name} (${zone.code}) -> ID: ${createdZone.id}`);
  }

  // ==========================================
  // 2. Seed Pincode Mappings (16 Realistic Pincodes)
  // ==========================================
  console.log('📮 Seeding pincode-to-zone mappings...');

  const pincodesData = [
    // ZONE_NORTH (North Metro)
    { pincode: '560001', areaName: 'Bangalore GPO / Central North', zoneCode: 'ZONE_NORTH' },
    { pincode: '560024', areaName: 'Hebbal / Manyata Tech Park', zoneCode: 'ZONE_NORTH' },
    { pincode: '560064', areaName: 'Yelahanka New Town', zoneCode: 'ZONE_NORTH' },
    { pincode: '560092', areaName: 'Sahakara Nagar / Kodigehalli', zoneCode: 'ZONE_NORTH' },

    // ZONE_SOUTH (South Suburban)
    { pincode: '560034', areaName: 'Koramangala 1st-4th Blocks', zoneCode: 'ZONE_SOUTH' },
    { pincode: '560041', areaName: 'Jayanagar 4th Block & South End', zoneCode: 'ZONE_SOUTH' },
    { pincode: '560076', areaName: 'BTM Layout 2nd Stage', zoneCode: 'ZONE_SOUTH' },
    { pincode: '560078', areaName: 'JP Nagar 6th Phase', zoneCode: 'ZONE_SOUTH' },

    // ZONE_WEST (West Central)
    { pincode: '560010', areaName: 'Rajajinagar Industrial & Commercial', zoneCode: 'ZONE_WEST' },
    { pincode: '560040', areaName: 'Vijayanagar West Hub', zoneCode: 'ZONE_WEST' },
    { pincode: '560079', areaName: 'Basaveshwara Nagar', zoneCode: 'ZONE_WEST' },
    { pincode: '560086', areaName: 'Mahalakshmi Layout / West Central', zoneCode: 'ZONE_WEST' },

    // ZONE_EAST (East Industrial)
    { pincode: '560038', areaName: 'Indiranagar 100ft Road / East Metro', zoneCode: 'ZONE_EAST' },
    { pincode: '560048', areaName: 'Whitefield Export Promotion Industrial Park', zoneCode: 'ZONE_EAST' },
    { pincode: '560066', areaName: 'Whitefield Main / Kadugodi Logistics', zoneCode: 'ZONE_EAST' },
    { pincode: '560067', areaName: 'Hoodi Industrial Estate & Fulfillment Park', zoneCode: 'ZONE_EAST' },
  ];

  for (const pin of pincodesData) {
    const zoneId = zoneMap[pin.zoneCode];
    await prisma.pincodeMapping.upsert({
      where: { pincode: pin.pincode },
      update: {
        areaName: pin.areaName,
        zoneId: zoneId,
      },
      create: {
        pincode: pin.pincode,
        areaName: pin.areaName,
        zoneId: zoneId,
      },
    });
  }
  console.log(`   ✓ Seeded ${pincodesData.length} pincode-to-zone mappings.`);

  // ==========================================
  // 3. Seed Dynamic Rate Cards
  // ==========================================
  console.log('💳 Seeding dynamic rate cards...');

  const rateCardsData = [
    {
      zoneType: 'INTRA_ZONE',
      customerType: 'B2C',
      baseWeightKg: 0.5,
      baseRate: 40.0,
      perKgRate: 20.0,
      volumetricDivisor: 5000.0,
      codFixedSurcharge: 25.0,
      codPercentSurcharge: 1.5,
      minCodSurcharge: 30.0,
      isActive: true,
    },
    {
      zoneType: 'INTRA_ZONE',
      customerType: 'B2B',
      baseWeightKg: 0.5,
      baseRate: 30.0,
      perKgRate: 15.0,
      volumetricDivisor: 5000.0,
      codFixedSurcharge: 15.0,
      codPercentSurcharge: 1.0,
      minCodSurcharge: 20.0,
      isActive: true,
    },
    {
      zoneType: 'INTER_ZONE',
      customerType: 'B2C',
      baseWeightKg: 0.5,
      baseRate: 75.0,
      perKgRate: 40.0,
      volumetricDivisor: 5000.0,
      codFixedSurcharge: 40.0,
      codPercentSurcharge: 2.0,
      minCodSurcharge: 50.0,
      isActive: true,
    },
    {
      zoneType: 'INTER_ZONE',
      customerType: 'B2B',
      baseWeightKg: 0.5,
      baseRate: 60.0,
      perKgRate: 30.0,
      volumetricDivisor: 5000.0,
      codFixedSurcharge: 25.0,
      codPercentSurcharge: 1.2,
      minCodSurcharge: 35.0,
      isActive: true,
    },
  ];

  for (const rc of rateCardsData) {
    const existing = await prisma.rateCard.findFirst({
      where: {
        zoneType: rc.zoneType,
        customerType: rc.customerType,
        isActive: true,
      },
    });

    if (existing) {
      await prisma.rateCard.update({
        where: { id: existing.id },
        data: rc,
      });
      console.log(`   ✓ Updated RateCard: ${rc.zoneType} / ${rc.customerType}`);
    } else {
      await prisma.rateCard.create({
        data: rc,
      });
      console.log(`   ✓ Created RateCard: ${rc.zoneType} / ${rc.customerType}`);
    }
  }

  // ==========================================
  // 4. Seed Demo Accounts & Profiles
  // ==========================================
  console.log('👤 Seeding default demo accounts (password: Password123!)...');

  // 4.1 Admin User
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@lastmile.local' },
    update: {
      passwordHash,
      name: 'System Administrator',
      phone: '+91-9876543210',
      role: 'ADMIN',
    },
    create: {
      email: 'admin@lastmile.local',
      passwordHash,
      name: 'System Administrator',
      phone: '+91-9876543210',
      role: 'ADMIN',
    },
  });
  console.log(`   ✓ Admin: ${adminUser.email} (Role: ADMIN)`);

  // 4.2 Agent 1 (North Metro & West Central)
  const agent1User = await prisma.user.upsert({
    where: { email: 'agent1@lastmile.local' },
    update: {
      passwordHash,
      name: 'Rajesh Kumar',
      phone: '+91-9876543211',
      role: 'AGENT',
    },
    create: {
      email: 'agent1@lastmile.local',
      passwordHash,
      name: 'Rajesh Kumar',
      phone: '+91-9876543211',
      role: 'AGENT',
    },
  });

  const agent1Profile = await prisma.deliveryAgentProfile.upsert({
    where: { userId: agent1User.id },
    update: {
      status: 'AVAILABLE',
      vehicleType: 'BIKE',
      vehicleNumber: 'KA-01-AB-1234',
      maxCapacity: 15,
      activeOrdersCount: 0,
    },
    create: {
      userId: agent1User.id,
      status: 'AVAILABLE',
      vehicleType: 'BIKE',
      vehicleNumber: 'KA-01-AB-1234',
      maxCapacity: 15,
      activeOrdersCount: 0,
    },
  });

  // Map Agent 1 to ZONE_NORTH and ZONE_WEST
  const agent1Zones = [zoneMap['ZONE_NORTH'], zoneMap['ZONE_WEST']];
  for (const zId of agent1Zones) {
    await prisma.agentZoneMapping.upsert({
      where: {
        agentId_zoneId: {
          agentId: agent1Profile.id,
          zoneId: zId,
        },
      },
      update: {},
      create: {
        agentId: agent1Profile.id,
        zoneId: zId,
      },
    });
  }
  console.log(`   ✓ Agent 1: ${agent1User.email} -> Operational in ZONE_NORTH & ZONE_WEST (AVAILABLE)`);

  // 4.3 Agent 2 (South Suburban & East Industrial)
  const agent2User = await prisma.user.upsert({
    where: { email: 'agent2@lastmile.local' },
    update: {
      passwordHash,
      name: 'Priya Sharma',
      phone: '+91-9876543212',
      role: 'AGENT',
    },
    create: {
      email: 'agent2@lastmile.local',
      passwordHash,
      name: 'Priya Sharma',
      phone: '+91-9876543212',
      role: 'AGENT',
    },
  });

  const agent2Profile = await prisma.deliveryAgentProfile.upsert({
    where: { userId: agent2User.id },
    update: {
      status: 'AVAILABLE',
      vehicleType: 'VAN',
      vehicleNumber: 'KA-05-CD-5678',
      maxCapacity: 25,
      activeOrdersCount: 0,
    },
    create: {
      userId: agent2User.id,
      status: 'AVAILABLE',
      vehicleType: 'VAN',
      vehicleNumber: 'KA-05-CD-5678',
      maxCapacity: 25,
      activeOrdersCount: 0,
    },
  });

  // Map Agent 2 to ZONE_SOUTH and ZONE_EAST
  const agent2Zones = [zoneMap['ZONE_SOUTH'], zoneMap['ZONE_EAST']];
  for (const zId of agent2Zones) {
    await prisma.agentZoneMapping.upsert({
      where: {
        agentId_zoneId: {
          agentId: agent2Profile.id,
          zoneId: zId,
        },
      },
      update: {},
      create: {
        agentId: agent2Profile.id,
        zoneId: zId,
      },
    });
  }
  console.log(`   ✓ Agent 2: ${agent2User.email} -> Operational in ZONE_SOUTH & ZONE_EAST (AVAILABLE)`);

  // 4.4 Customer B2C Account
  const customerB2C = await prisma.user.upsert({
    where: { email: 'customer@lastmile.local' },
    update: {
      passwordHash,
      name: 'Aarav Mehta',
      phone: '+91-9876543213',
      role: 'CUSTOMER',
    },
    create: {
      email: 'customer@lastmile.local',
      passwordHash,
      name: 'Aarav Mehta',
      phone: '+91-9876543213',
      role: 'CUSTOMER',
    },
  });

  // Seed default address book for Customer B2C
  await prisma.address.deleteMany({ where: { userId: customerB2C.id } });
  await prisma.address.createMany({
    data: [
      {
        userId: customerB2C.id,
        label: 'Home (North Metro)',
        street: 'Flat 402, Green Glen Apartments, Sahakara Nagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560092',
        contactName: 'Aarav Mehta',
        contactPhone: '+91-9876543213',
        isDefault: true,
      },
      {
        userId: customerB2C.id,
        label: 'Office (South Suburb)',
        street: '88, 5th Main Road, 4th Block, Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        contactName: 'Aarav Mehta (Work)',
        contactPhone: '+91-9876543213',
        isDefault: false,
      },
    ],
  });
  console.log(`   ✓ Customer B2C: ${customerB2C.email} (Role: CUSTOMER, B2C addresses initialized)`);

  // 4.5 Customer B2B Account
  const customerB2B = await prisma.user.upsert({
    where: { email: 'b2b@lastmile.local' },
    update: {
      passwordHash,
      name: 'Apex Retail Enterprises',
      phone: '+91-9876543214',
      role: 'CUSTOMER',
    },
    create: {
      email: 'b2b@lastmile.local',
      passwordHash,
      name: 'Apex Retail Enterprises',
      phone: '+91-9876543214',
      role: 'CUSTOMER',
    },
  });

  // Seed default warehouse address for Customer B2B
  await prisma.address.deleteMany({ where: { userId: customerB2B.id } });
  await prisma.address.create({
    data: {
      userId: customerB2B.id,
      label: 'Main Fulfillment Hub (East Industrial)',
      street: 'Plot 14-B, Hoodi Industrial Estate, Near ITPL Main Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560067',
      contactName: 'Logistics Desk - Apex Retail',
      contactPhone: '+91-9876543214',
      isDefault: true,
    },
  });
  console.log(`   ✓ Customer B2B: ${customerB2B.email} (Role: CUSTOMER, B2B warehouse address initialized)`);

  console.log('✅ Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
