package com.lolzcloud.mobile;

import java.io.IOException;

/** Android JSONTokener is lenient; portable files use strict bounded JSON like JSON.parse. */
public final class ProfileJson {
    private final String text; private int at;
    private ProfileJson(String text) { this.text = text; }
    public static void requireObject(String text) throws IOException {
        if (text == null || text.length() > 1024 * 1024) throw new IOException("Файл профиля слишком большой");
        ProfileJson parser = new ProfileJson(text); parser.space();
        if (parser.peek() != '{') throw new IOException("Профиль должен быть JSON-объектом");
        parser.value(0); parser.space(); if (parser.at != text.length()) parser.bad();
    }
    private char peek() { return at < text.length() ? text.charAt(at) : '\0'; }
    private void space() { while (at < text.length() && " \n\r\t".indexOf(text.charAt(at)) >= 0) at++; }
    private void bad() throws IOException { throw new IOException("Файл профиля содержит некорректный JSON"); }
    private void value(int depth) throws IOException {
        if (depth > 32) throw new IOException("Профиль слишком глубоко вложен");
        space(); char c = peek();
        if (c == '{') { at++; space(); if (peek() == '}') { at++; return; } while (true) { if (peek() != '"') bad(); string(); space(); if (peek() != ':') bad(); at++; value(depth + 1); space(); c = peek(); at++; if (c == '}') return; if (c != ',') bad(); space(); } }
        else if (c == '[') { at++; space(); if (peek() == ']') { at++; return; } while (true) { value(depth + 1); space(); c = peek(); at++; if (c == ']') return; if (c != ',') bad(); } }
        else if (c == '"') string();
        else if (c == 't') literal("true"); else if (c == 'f') literal("false"); else if (c == 'n') literal("null");
        else number();
    }
    private void literal(String value) throws IOException { if (!text.startsWith(value, at)) bad(); at += value.length(); }
    private void string() throws IOException {
        at++;
        while (at < text.length()) {
            char c = text.charAt(at++); if (c == '"') return; if (c < 32) bad();
            if (c == '\\') { if (at >= text.length()) bad(); char escape = text.charAt(at++); if (escape == 'u') { for (int i = 0; i < 4; i++) { if (at >= text.length() || "0123456789abcdefABCDEF".indexOf(text.charAt(at++)) < 0) bad(); } } else if ("\"\\/bfnrt".indexOf(escape) < 0) bad(); }
        }
        bad();
    }
    private boolean digit() { return peek() >= '0' && peek() <= '9'; }
    private void number() throws IOException {
        int start = at; if (peek() == '-') at++;
        if (peek() == '0') at++; else { if (peek() < '1' || peek() > '9') bad(); while (digit()) at++; }
        if (peek() == '.') { at++; if (!digit()) bad(); while (digit()) at++; }
        if (peek() == 'e' || peek() == 'E') { at++; if (peek() == '-' || peek() == '+') at++; if (!digit()) bad(); while (digit()) at++; }
        try { if (!Double.isFinite(Double.parseDouble(text.substring(start, at)))) bad(); }
        catch (NumberFormatException invalid) { bad(); }
    }
}
