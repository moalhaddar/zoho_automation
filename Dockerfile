FROM ubuntu:20.04

# TODO, fix the driver and google chrome versions to be specific
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
RUN apt update
RUN apt install default-jre
RUN apt install ./google-chrome-stable_current_amd64.deb
