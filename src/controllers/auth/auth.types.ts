export interface AuthUserView {
  id: string;
  email: string;
  name: string;
  role: "user";
  twoFactorEnabled: false;
}

export interface AuthSessionView {
  user: AuthUserView;
  accessToken: string;
  expiresAt: string;
}
