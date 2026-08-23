export const AUTH_COOKIE_NAME = 'auth-token';
export const TOKEN_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds
export const TOKEN_EXPIRATION_STR = '7d';

export const USER_ROLES = {
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const ALL_ROLES: UserRole[] = [
  USER_ROLES.CUSTOMER,
  USER_ROLES.AGENT,
  USER_ROLES.ADMIN,
];
