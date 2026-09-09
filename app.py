import webview


def main():
    webview.create_window(
        "Math Notebook",
        "frontend/index.html",
        width=900,
        height=700,
    )
    webview.start()


if __name__ == "__main__":
    main()
