export function keycloakLogoutUrl({
  issuer,
  clientId,
  idToken,
  postLogoutRedirectUri,
}: {
  issuer: string;
  clientId: string;
  idToken?: string;
  postLogoutRedirectUri: string;
}): URL {
  const url = new URL(
    `${issuer.replace(/\/+$/, "")}/protocol/openid-connect/logout`,
  );
  url.searchParams.set("client_id", clientId);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);
  return url;
}
