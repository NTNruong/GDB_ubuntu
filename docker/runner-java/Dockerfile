FROM eclipse-temurin:21-jdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash coreutils ca-certificates time \
  && rm -rf /var/lib/apt/lists/*

COPY run-java /usr/local/bin/run-java
RUN chmod +x /usr/local/bin/run-java

WORKDIR /workspace
