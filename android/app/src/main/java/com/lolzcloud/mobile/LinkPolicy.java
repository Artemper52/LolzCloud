package com.lolzcloud.mobile;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Invitations are canonical links to one room or one computer remote. */
public final class LinkPolicy {
    private LinkPolicy() { }

    public static String lolzCloud(String address, String kind) throws IOException {
        if (!"room".equals(kind) && !"remote".equals(kind)) throw new IOException("Неизвестный тип ссылки");
        String message = "room".equals(kind) ? "Скопируй полную ссылку приглашения из комнаты LolzCloud" : "Нужна полная ссылка пульта с компьютера";
        try {
            URI uri = new URI(address == null ? "" : address.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"lolzcloud.com".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)
                    || uri.getRawPath() == null || !uri.getRawPath().matches("/" + kind + "/[a-fA-F0-9]{32}/?"))
                throw new IOException(message);
            String path = uri.getRawPath().replaceAll("/$", "").toLowerCase(Locale.ROOT);
            return "https://lolzcloud.com" + path;
        } catch (URISyntaxException error) {
            throw new IOException(message);
        }
    }
}
