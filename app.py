import webview

from mathnb.api import Api


def main():
    api = Api()
    webview.create_window(
        "Math Notebook",
        "frontend/index.html",
        js_api=api,
        width=900,
        height=700,
    )
    webview.start()


if __name__ == "__main__":
    main()
