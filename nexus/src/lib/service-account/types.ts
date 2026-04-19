export interface ServiceAccountConfig {
  /** Full PVE token id: "user@realm!tokenname" (e.g. "nexus@pve!automation"). */
  tokenId: string;
  /** UUID secret PVE issued when the token was created. */
  secret: string;
  /** PVE host — e.g. "127.0.0.1" or a cluster FQDN. */
  proxmoxHost: string;
  /** Epoch ms. */
  savedAt: number;
}

export interface ServiceAccountSession {
  tokenId: string;
  secret: string;
  proxmoxHost: string;
}
