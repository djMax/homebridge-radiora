A very bare bones implementation of Lutron RadioRA control for Siri/HomeKit. Here's a sample config fragment (which is an entry in the "platforms" array of your root config):

```
{
            "platform": "RadioRA",
            "host": "192.168.1.55",
            "username": "SOME_USERNAME",
            "password": "SOME_PASSWORD",
            "lights": [
                {
                    "name": "Outside",
                    "id": 14,
                    "serial": "d9561223-4e57-4521-b09c-aaadac1df314"
                },
                {
                    "name": "Playroom",
                    "id": 22,
                    "serial": "d9561223-4e57-4521-b09c-aaadac1df322"
                }
            ]
        }
```

The id comes from the RadioRA software, the serial is just made up with a guid generator. Change host, username and password to match your install as well.
