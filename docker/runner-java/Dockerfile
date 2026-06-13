# Bundle several Temurin JDKs in one image; the entrypoint picks one per request
# (JAVA_VERSION). Multi-stage COPY pins exact Adoptium builds without an apt repo.
FROM eclipse-temurin:17-jdk AS jdk17
FROM eclipse-temurin:21-jdk AS jdk21
FROM eclipse-temurin:25-jdk AS jdk25

FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time \
  && rm -rf /var/lib/apt/lists/*

# Temurin images install the JDK at /opt/java/openjdk — land each under its version.
COPY --from=jdk17 /opt/java/openjdk /opt/java/17
COPY --from=jdk21 /opt/java/openjdk /opt/java/21
COPY --from=jdk25 /opt/java/openjdk /opt/java/25

COPY run-java /usr/local/bin/run-java
RUN chmod +x /usr/local/bin/run-java

WORKDIR /workspace
